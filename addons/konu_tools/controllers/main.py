# Copyright (c) 2026 Konu Consulting BV. All rights reserved.
"""HTTP and JSON-RPC entry points for konu_tools.

* :code:`/konu_tools/visualiser/<id>` — serves the bundled inventory
  visualiser HTML, with the connection ID injected so the React app
  routes its RPCs back here instead of to the standalone proxy.
* :code:`/konu_tools/rpc/<id>` — JSON-RPC bridge. The browser POSTs
  :code:`{path, params}` (without the customer's API key); the controller
  looks up the connection, decrypts the key, and forwards the call to
  the customer's Odoo using a per-(connection, user) cached session.
"""
import json
import logging
import os
import threading
from collections import defaultdict

from odoo import _, http
from odoo.http import request
from odoo.exceptions import AccessError, UserError

_logger = logging.getLogger(__name__)

# Per-(connection_id, user_id) requests.Session cache. Populated lazily.
# Keeps the customer Odoo session_id cookie alive across calls so we don't
# re-authenticate on every RPC. Wiped on worker restart.
_SESSIONS = defaultdict(dict)
_SESSIONS_LOCK = threading.Lock()


def _session_key(connection_id, user_id):
    return (int(connection_id), int(user_id))


def _get_or_create_session(connection_id, user_id):
    """Return a stable session_state dict for this (connection, user) pair."""
    import requests
    key = _session_key(connection_id, user_id)
    with _SESSIONS_LOCK:
        st = _SESSIONS.get(key)
        if st is None or st.get("session") is None:
            st = {"session": requests.Session(), "authed": False}
            _SESSIONS[key] = st
        return st


class KonuToolsController(http.Controller):

    # ─── Bundled HTML serving ───────────────────────────────────────────────
    @http.route("/konu_tools/visualiser/<int:connection_id>", type="http",
                auth="user", methods=["GET"], csrf=False)
    def visualiser(self, connection_id, **kw):
        conn = request.env["konu.customer.connection"].browse(connection_id)
        try:
            conn.check_access_rights("read")
            conn.check_access_rule("read")
        except AccessError:
            return request.not_found()
        if not conn.exists() or not conn.active:
            return request.not_found()

        # Locate the bundled HTML — copied here by the build script.
        bundle_path = os.path.join(
            os.path.dirname(__file__), "..", "static", "src", "bundle",
            "odoo-inventory-flow.html",
        )
        bundle_path = os.path.realpath(bundle_path)
        if not os.path.exists(bundle_path):
            return request.make_response(
                "<h2>Visualiser bundle missing</h2>"
                "<p>Run <code>npm run build:module</code> from the repo root.</p>",
                [("Content-Type", "text/html; charset=utf-8")],
            )
        with open(bundle_path, "r", encoding="utf-8") as f:
            html = f.read()

        # Inject runtime config so the React app knows it's running in Konu mode
        cfg = {
            "konuMode": True,
            "connectionId": connection_id,
            "connectionName": conn.name,
            "customerName": conn.partner_id.display_name,
            "baseUrl": conn.base_url,
            "dbName": conn.db_name,
            "allowWrite": conn.allow_write,
            "csrfToken": request.csrf_token(),
        }
        injection = (
            "<script>window.__KONU_CFG__ = %s;</script>" % json.dumps(cfg)
        )
        html = html.replace("</head>", injection + "</head>", 1)

        conn._record_use(action="open", success=True,
                         message="Opened visualiser")

        return request.make_response(
            html,
            headers=[
                ("Content-Type", "text/html; charset=utf-8"),
                ("X-Frame-Options", "SAMEORIGIN"),
            ],
        )

    # ─── JSON-RPC bridge ────────────────────────────────────────────────────
    @http.route("/konu_tools/rpc/<int:connection_id>", type="json",
                auth="user", methods=["POST"])
    def rpc(self, connection_id, path=None, params=None, **kw):
        conn = request.env["konu.customer.connection"].browse(connection_id)
        try:
            conn.check_access_rights("read")
            conn.check_access_rule("read")
        except AccessError:
            return {"error": {"message": "Access denied to connection."}}
        if not conn.exists() or not conn.active:
            return {"error": {"message": "Connection not found or inactive."}}
        if not path or params is None:
            return {"error": {"message": "Missing path or params."}}

        # Block writes unless allow_write is set
        method = (params or {}).get("method") or ""
        is_write = method in ("write", "create", "unlink", "load",
                              "action_confirm", "action_cancel", "action_done")
        if is_write and not conn.allow_write:
            conn._record_use(action="rpc", success=False,
                             model_called=(params or {}).get("model"),
                             method_called=method,
                             message="Blocked: connection is read-only")
            return {"error": {"message":
                "This connection is marked read-only. Toggle 'Allow Writes' "
                "on the connection record to enable pushes."}}

        # Forward the call
        st = _get_or_create_session(connection_id, request.env.user.id)
        try:
            result = conn._proxy_rpc(path, params, session_state=st)
            conn._record_use(
                action="rpc", success=True,
                model_called=(params or {}).get("model"),
                method_called=method,
            )
            return {"result": result}
        except UserError as e:
            # Most likely auth or scope. Reset auth flag so next call re-auths.
            st["authed"] = False
            conn._record_use(
                action="rpc", success=False,
                model_called=(params or {}).get("model"),
                method_called=method,
                message=str(e),
            )
            return {"error": {"message": str(e)}}
        except Exception as e:
            _logger.exception("konu_tools RPC failure")
            st["authed"] = False
            conn._record_use(action="rpc", success=False, message=str(e))
            return {"error": {"message": "Internal proxy error: %s" % e}}
