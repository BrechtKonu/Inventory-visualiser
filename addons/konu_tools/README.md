# Konu Tools

Internal Odoo module living **inside Konu's own Odoo** (not customer-side).
It is a single hub for tools Konu consultants run *against* customer Odoo
instances — starting with the **Inventory Visualiser**.

## What it gives you

1. **Customer connection registry** — `konu.customer.connection` records, one
   per (customer, database). Each record holds the base URL, DB name, login,
   and an **encrypted API key** (Fernet). Tied to `res.partner` and
   optionally `project.project` so the connection shows up on the customer
   file and project chatter.
2. **Tool catalog** — `konu.tool` records describe each tool (visualiser
   today, more later). Each has a slug-based URL template and per-group
   access control.
3. **Audit log** — every RPC call and tool open is recorded in
   `konu.tool.usage.log` with who/what/when/success.
4. **Inventory Visualiser served from this module** — opens in a new tab
   with no credential prompt; all RPCs to the customer Odoo are proxied
   server-side via `/konu_tools/rpc/<connection_id>` using the stored API
   key.

## Architecture

```
Consultant browser ── /konu_tools/visualiser/<id> ──▶ Konu Odoo (HTML bundle)
                  ── /konu_tools/rpc/<id> ─────────▶ Konu Odoo controller
                                                     │
                                                     │ requests + stored key
                                                     ▼
                                               Customer Odoo
```

Pros vs. customer-side install:
* Works for **every Odoo flavor**, including Odoo Online (no module needed there).
* Single install, single upgrade. Updates roll out the moment we redeploy Konu's Odoo.
* Native Odoo benefits: chatter on connections, project linkage, ACLs, audit log.
* The same connection registry **powers the `odoo-customer` MCP server** (KOTASK-065 Phase 2).

Tradeoff:
* Konu holds customer credentials (encrypted at rest) and the customer's data
  flows through Konu's network. Discuss with the customer's security team
  and add the data-processing addendum if needed.

## Installation

1. Copy `addons/konu_tools/` into Konu's Odoo addons path (typically a
   submodule of the Konu Odoo deployment repo).
2. Build the React bundle from this repo: `npm run build`. The build emits
   `addons/konu_tools/static/src/bundle/odoo-inventory-flow.html`
   automatically.
3. Update apps list and install **Konu Tools** in Konu's Odoo.
4. Set the Fernet master key — strongly recommended in production:
   ```bash
   export KONU_TOOLS_FERNET_KEY="$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
   ```
   Restart Odoo. Without this env var, the key is auto-generated into
   `ir.config_parameter` (less secure — a DB dump alone leaks all keys).
5. Add the `konu_tools.group_konu_tools_admin` group to Konu admins, and
   `konu_tools.group_konu_tools_user` to consultants.

## Usage

**Set up a connection (admin)**

1. *Konu Tools → Customer Connections → New*
2. Slug name (e.g. `acme-staging`), pick the customer (`res.partner`), pick the
   project, fill base URL / DB / login.
3. Paste the customer API key into *Set API Key* — saves encrypted.
4. Click *Test Connection* to verify.

**Open the visualiser (consultant)**

* From the kanban, click *Open Visualiser* on any connection — a new tab
  opens with the React app already authenticated to that customer.
* Or visit `/konu_tools/visualiser/<id>` directly.

## Read-only by default

`allow_write` defaults to **off**. Push attempts return a clear error until
an admin flips it on for that specific connection. Forces explicit consent
before any RPC touches a customer's stock data.

## Reuse for the MCP

Connections marked `mcp_exposed=True` are intended for the
`odoo-customer` MCP server: when the server starts, it reads the registry
from Konu's Odoo (via the Konu admin's API key), discovers each connection,
and exposes them as named slugs to Claude Code. This unifies the tools and
MCP under one source of truth — see KOTASK-065 Phase 2.

## Files

| Path | Purpose |
|---|---|
| `models/konu_customer_connection.py` | The connection model — registry + encryption + RPC helper. |
| `models/konu_tool.py` | Tool catalog. |
| `models/konu_tool_usage_log.py` | Audit log (read-only). |
| `controllers/main.py` | HTTP entry for the bundle + JSON-RPC bridge. |
| `views/*.xml` | List / form / kanban / menus. |
| `data/konu_tool_data.xml` | Seed: registers the visualiser tool. |
| `security/*.{xml,csv}` | Two groups + ACLs + record rules. |
| `static/src/bundle/odoo-inventory-flow.html` | Built by `npm run build` from the repo root. |

## Roadmap (post-v1)

* OWL `client_action` so the visualiser opens **inside** Konu's Odoo
  breadcrumb chrome (instead of new tab) — small wrapper over an
  `<iframe src="/konu_tools/visualiser/<id>">` with bidirectional postMessage
  for save/close events.
* Per-(connection, user) requests session caching to remove the 200ms
  re-auth on each call.
* Wizard for "Bulk-import customer connections from a CSV / from Konu's
  CRM `crm.lead` stage = won".
* `konu.tool` registry growing to include: Warehouse Audit, Route Printer,
  Putaway Tester, Sale-flow Visualiser.
* Hook into `mail.activity` so connections with API keys older than 6
  months auto-create a "rotate API key" follow-up.
