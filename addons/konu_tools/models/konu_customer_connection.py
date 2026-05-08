# Copyright (c) 2026 Konu Consulting BV. All rights reserved.
"""Central registry of Konu customer Odoo connections.

A `konu.customer.connection` record stores the credentials for one customer
Odoo database. The same record is reused by:

* the **Inventory Visualiser** (and any future Konu Tool) — used through the
  in-Odoo client action and proxied via :code:`/konu_tools/rpc/<id>`;
* Konu's :code:`odoo-customer` MCP server (KOTASK-065 Phase 2) — read at
  startup so Claude Code can address customer instances by slug without each
  consultant copy-pasting credentials;
* presale / project flows — every connection is tied to a
  :code:`res.partner` and optionally a :code:`project.project` so usage shows
  up in the customer file and on the project chatter.

API keys are encrypted at rest with :code:`cryptography.fernet`. The Fernet
master key is read from the :code:`KONU_TOOLS_FERNET_KEY` environment
variable when present, otherwise from :code:`ir.config_parameter`
:code:`konu_tools.fernet_key` (auto-generated on first install). Storing the
key in env is recommended for production so a DB dump alone does not leak
customer credentials.
"""
import base64
import logging
import os
from urllib.parse import urlparse

from odoo import _, api, fields, models
from odoo.exceptions import UserError, ValidationError

_logger = logging.getLogger(__name__)

try:
    from cryptography.fernet import Fernet, InvalidToken
except ImportError:  # pragma: no cover
    Fernet = None
    InvalidToken = Exception
    _logger.warning("cryptography package missing — install it to use konu_tools")


class KonuCustomerConnection(models.Model):
    _name = "konu.customer.connection"
    _description = "Konu Customer Odoo Connection"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "sequence, name"

    # --- Identification -----------------------------------------------------
    name = fields.Char(
        string="Connection Name",
        required=True,
        tracking=True,
        help="Short slug used by the MCP server and tool URLs. "
             "Use lowercase, hyphens, no spaces — e.g. 'acme-staging'.",
    )
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True, tracking=True)
    color = fields.Integer()

    partner_id = fields.Many2one(
        "res.partner",
        string="Customer",
        required=True,
        tracking=True,
        index=True,
        help="The Konu customer this connection belongs to.",
    )
    project_id = fields.Many2one(
        "project.project",
        string="Project",
        tracking=True,
        domain="[('partner_id', '=', partner_id)]",
        help="Optional Konu project this connection is associated with. "
             "Helps with sprint reporting, timesheets, and chatter cross-references.",
    )

    # --- Connection details -------------------------------------------------
    base_url = fields.Char(
        string="Base URL",
        required=True,
        tracking=True,
        help="https://customer.odoo.com (no trailing slash).",
    )
    db_name = fields.Char(string="Database", required=True, tracking=True)
    login = fields.Char(string="Login / User", required=True, tracking=True)
    api_key_encrypted = fields.Char(
        string="API Key (encrypted)",
        groups="konu_tools.group_konu_tools_admin",
        help="Encrypted Fernet token of the customer Odoo API key. "
             "Set via the 'Set API Key' input; never edited inline.",
    )
    api_key_input = fields.Char(
        string="Set API Key",
        store=False,
        groups="konu_tools.group_konu_tools_admin",
        inverse="_inverse_api_key_input",
        help="Type/paste the new API key here. On save it is encrypted and "
             "the plain value is discarded. Field always reads as empty.",
    )
    api_key_set = fields.Boolean(
        string="Has API Key",
        compute="_compute_api_key_set",
        help="True if an API key is stored. Doesn't reveal the key itself.",
    )

    odoo_version = fields.Selection(
        [("17.0", "17.0"), ("18.0", "18.0"), ("19.0", "19.0"), ("master", "master")],
        string="Odoo Version",
        tracking=True,
    )
    environment = fields.Selection(
        [("production", "Production"), ("staging", "Staging"), ("dev", "Development")],
        default="staging",
        tracking=True,
    )

    # --- Authorization gates ------------------------------------------------
    allow_write = fields.Boolean(
        string="Allow Writes",
        default=False,
        tracking=True,
        help="If unset, only read RPC calls are forwarded. Write/create/unlink "
             "calls return an error. Default off for safety — flip on per "
             "connection when you actually need to push.",
    )
    mcp_exposed = fields.Boolean(
        string="Expose to MCP",
        default=True,
        tracking=True,
        help="When enabled, Konu's odoo-customer MCP server includes this "
             "connection in its registry, so Claude Code can target it by slug.",
    )

    # --- Usage stats --------------------------------------------------------
    last_used = fields.Datetime(string="Last Used", readonly=True)
    use_count = fields.Integer(string="Use Count", readonly=True, default=0)
    log_ids = fields.One2many("konu.tool.usage.log", "connection_id", string="Usage Log")
    log_count = fields.Integer(compute="_compute_log_count")

    description = fields.Html(string="Notes")

    _sql_constraints = [
        ("name_uniq", "UNIQUE(name)", "Connection name must be unique (used as a slug)."),
        ("partner_db_uniq", "UNIQUE(partner_id, db_name)",
         "Each customer can only have one connection per database."),
    ]

    # ─── Compute / constraints ──────────────────────────────────────────────
    @api.depends("api_key_encrypted")
    def _compute_api_key_set(self):
        for rec in self:
            rec.api_key_set = bool(rec.sudo().api_key_encrypted)

    def _inverse_api_key_input(self):
        for rec in self:
            if rec.api_key_input:
                rec.set_api_key(rec.api_key_input)

    def _compute_log_count(self):
        for rec in self:
            rec.log_count = self.env["konu.tool.usage.log"].search_count(
                [("connection_id", "=", rec.id)]
            )

    @api.constrains("name")
    def _check_name_slug(self):
        for rec in self:
            if not rec.name:
                continue
            if rec.name != rec.name.lower() or " " in rec.name:
                raise ValidationError(
                    _("Connection name must be lowercase with no spaces (slug). Got: %s") % rec.name
                )

    @api.constrains("base_url")
    def _check_base_url(self):
        for rec in self:
            if not rec.base_url:
                continue
            parsed = urlparse(rec.base_url)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                raise ValidationError(_("Base URL must start with http:// or https://"))
            if rec.base_url.endswith("/"):
                raise ValidationError(_("Base URL must not end with a trailing slash"))

    # ─── Encryption helpers ─────────────────────────────────────────────────
    @api.model
    def _get_fernet(self):
        """Return a Fernet instance using the master key from env or ir.config_parameter."""
        if Fernet is None:
            raise UserError(_("Python package 'cryptography' is not installed."))
        key = os.environ.get("KONU_TOOLS_FERNET_KEY")
        if not key:
            ICP = self.env["ir.config_parameter"].sudo()
            key = ICP.get_param("konu_tools.fernet_key")
            if not key:
                key = Fernet.generate_key().decode("ascii")
                ICP.set_param("konu_tools.fernet_key", key)
                _logger.warning(
                    "konu_tools: generated new Fernet key and stored it in "
                    "ir.config_parameter. For production, move it to the "
                    "KONU_TOOLS_FERNET_KEY environment variable instead."
                )
        if isinstance(key, str):
            key = key.encode("ascii")
        return Fernet(key)

    def set_api_key(self, plain_key):
        """Encrypt and store the API key. Admins call this from the UI wizard."""
        self.ensure_one()
        if not plain_key:
            raise UserError(_("API key cannot be empty."))
        fernet = self._get_fernet()
        token = fernet.encrypt(plain_key.encode("utf-8"))
        self.sudo().write({"api_key_encrypted": token.decode("ascii")})
        self.message_post(body=_("API key updated by %s.") % self.env.user.name)
        return True

    def get_api_key(self):
        """Decrypt and return the API key. Internal — never expose over RPC."""
        self.ensure_one()
        if not self.sudo().api_key_encrypted:
            raise UserError(_("No API key set on connection '%s'.") % self.name)
        fernet = self._get_fernet()
        try:
            return fernet.decrypt(self.sudo().api_key_encrypted.encode("ascii")).decode("utf-8")
        except InvalidToken:
            raise UserError(
                _("API key for '%s' could not be decrypted. The Fernet master "
                  "key probably changed since it was stored — re-set the key.")
                % self.name
            )

    def clear_api_key(self):
        for rec in self:
            rec.sudo().write({"api_key_encrypted": False})
            rec.message_post(body=_("API key cleared by %s.") % self.env.user.name)
        return True

    # ─── Usage tracking ─────────────────────────────────────────────────────
    def _record_use(self, tool_id=False, action="rpc", success=True, message=None,
                   model_called=False, method_called=False):
        for rec in self:
            rec.sudo().write({
                "last_used": fields.Datetime.now(),
                "use_count": rec.use_count + 1,
            })
            self.env["konu.tool.usage.log"].sudo().create({
                "connection_id": rec.id,
                "tool_id": tool_id or False,
                "user_id": self.env.user.id,
                "action": action,
                "model_called": model_called,
                "method_called": method_called,
                "success": success,
                "message": message or "",
            })

    # ─── UI actions ─────────────────────────────────────────────────────────
    def action_open_visualiser(self):
        self.ensure_one()
        return {
            "type": "ir.actions.act_url",
            "url": "/konu_tools/visualiser/%d" % self.id,
            "target": "new",
        }

    def action_test_connection(self):
        """Quick health probe — calls /web/session/authenticate on the customer Odoo."""
        self.ensure_one()
        try:
            self._proxy_rpc("/web/session/authenticate", {
                "db": self.db_name, "login": self.login,
                "password": self.get_api_key(),
            })
            self._record_use(action="test", success=True, message="OK")
            return {"type": "ir.actions.client", "tag": "display_notification",
                    "params": {"type": "success",
                               "message": _("Connected to %s.") % self.base_url, "sticky": False}}
        except Exception as e:
            self._record_use(action="test", success=False, message=str(e))
            return {"type": "ir.actions.client", "tag": "display_notification",
                    "params": {"type": "danger",
                               "message": _("Failed: %s") % e, "sticky": True}}

    def action_view_logs(self):
        self.ensure_one()
        return {
            "type": "ir.actions.act_window",
            "name": _("Usage Log — %s") % self.name,
            "res_model": "konu.tool.usage.log",
            "view_mode": "list,form",
            "domain": [("connection_id", "=", self.id)],
            "context": {"default_connection_id": self.id},
        }

    # ─── RPC proxy primitive ────────────────────────────────────────────────
    def _proxy_rpc(self, path, params, session_state=None):
        """Issue a JSON-RPC call to the customer Odoo and return the result.

        Used both by the controller (for browser-driven calls) and any
        future server-side tooling. Authentication is via ``/web/session/
        authenticate`` with the API key as password — works on every Odoo
        version we target, no per-version branching.
        """
        import requests
        self.ensure_one()
        timeout = float(self.env["ir.config_parameter"].sudo().get_param(
            "konu_tools.rpc_timeout", default="30"))

        s = (session_state or {}).get("session") or requests.Session()
        # Authenticate if the session is fresh
        if not (session_state or {}).get("authed"):
            auth_payload = {
                "jsonrpc": "2.0", "method": "call",
                "params": {"db": self.db_name, "login": self.login,
                           "password": self.get_api_key()},
            }
            r = s.post(self.base_url + "/web/session/authenticate",
                       json=auth_payload, timeout=timeout)
            r.raise_for_status()
            j = r.json()
            if j.get("error") or not j.get("result", {}).get("uid"):
                raise UserError(
                    _("Authentication to %s failed: %s") %
                    (self.base_url, j.get("error", {}).get("data", {}).get("message")
                     or j.get("error", {}).get("message") or "Bad credentials"))
            if session_state is not None:
                session_state["authed"] = True

        # If caller already wanted /web/session/authenticate, we just did it
        if path == "/web/session/authenticate":
            return {"uid": s.cookies.get("session_id") and 1, "ok": True}

        payload = {"jsonrpc": "2.0", "method": "call", "params": params}
        r = s.post(self.base_url + path, json=payload, timeout=timeout)
        r.raise_for_status()
        j = r.json()
        if j.get("error"):
            err = j["error"]
            msg = (err.get("data", {}) or {}).get("message") or err.get("message") or "RPC error"
            raise UserError(_("Customer Odoo error: %s") % msg)
        return j.get("result")
