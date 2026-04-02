# Odoo Inventory Flow Visualiser

A visual designer for Odoo inventory workflows — warehouses, locations, operation types, routes, rules, and putaway rules — delivered as a single self-contained HTML file.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later

## Installation

```bash
npm install
npm run build
```

This produces `dist/odoo-inventory-flow.html` — a single file with all JavaScript inlined. No server required to open it.

---

## Running

### Offline / manual mode

Open `dist/odoo-inventory-flow.html` directly in your browser. Design and edit workflows freely, export/import as JSON. No live Odoo connection is available in this mode.

### Live Odoo connection (proxy mode)

Browsers block direct Odoo API calls from a local file due to CORS. Use the included proxy server:

```bash
npm run proxy
```

Then open **http://localhost:4173**.

Click the **API** button in the toolbar, enter your Odoo URL, database name, username, and API key. You can then fetch your real inventory configuration or write changes back.

> Proxy sessions are held in memory — they are lost when the proxy server restarts.

Override the default address with environment variables:

```bash
HOST=0.0.0.0 PORT=8080 npm run proxy
```

---

## Canvas controls

| Action | Result |
|--------|--------|
| Scroll wheel | Zoom in / out |
| Click + drag canvas | Pan |
| Click node or route | Select (shows property panel) |
| Drag node | Move node |
| Shift + click nodes | Add to / remove from multi-selection |
| Drag any selected node | Move all selected nodes together |
| Ctrl+Z / Ctrl+Y | Undo / Redo (up to 50 steps) |

Press the **?** button in the toolbar to show a quick-reference card for these shortcuts at any time.

---

## Toolbar

| Button | Action |
|--------|--------|
| **Add** | Add a new node, operation type, or route |
| **API** | Open the API / code-generation panel |
| **⚙** | Configure Odoo connection (URL, database, API key) |
| **⊞** | Auto-layout — automatically arrange nodes |
| **☀ / ☾** | Toggle light / dark theme |
| **↩ / ↪** | Undo / Redo |
| **?** | Show canvas tips |
| **Fit** | Zoom and pan to fit all nodes in view |
| **nn%** | Current zoom level |

---

## Auto-layout

Click **⊞** to automatically arrange all nodes based on the inventory flow direction:

- **Vendors (supplier)** — leftmost column
- **Internal locations** — middle columns, ordered by depth in the route graph
- **Customers** — rightmost column
- **Production & transit locations** — top lane, above the main flow
- **Warehouses** — header row at the very top

The layout is computed from the actual route rules and operation types, so receipt flows land on the left and delivery flows on the right. The action is undoable with Ctrl+Z.

---

## Routes & Rules sidebar

The left sidebar lists all routes and their rules. Use the **filter input** at the top to search by name — it matches against route names and rule names simultaneously.

Click any route or rule to select it and open its properties in the right panel. Use the eye icon to hide or show a route's edges on the canvas. Click **+ Add rule** under a route to append a new rule to it.

---

## Property panel

Clicking a node, operation type, route, or rule opens its property panel on the right. Fields map directly to Odoo model fields. Changes take effect immediately and are undoable.

---

## Putaway rules

Internal location nodes show a small **⇲** badge in the top-right corner when putaway rules exist for that location (the number indicates how many). Click the badge to open the putaway panel, where you can add, edit, and delete rules for that location.

---

## Saving your work

State is **not saved automatically** — it resets to the built-in sample data on every page load.

- **Export** (via the API panel or toolbar) — saves the full diagram and API configuration as a JSON file.
- **Import** — restores a previously exported JSON file.

---

## API / code generation

The **API** panel provides two tabs:

- **Fetch** — a ready-to-run Python `xmlrpc` script that reads your Odoo inventory configuration into variables.
- **Write** — a Python script that applies your current diagram as configuration changes to a live Odoo instance.

Both scripts are generated from the current diagram state and can be copied to the clipboard.

When the proxy server is running and credentials are configured, the panel can also make live read/write calls directly.

---

## Light and dark mode

Use the **☀ / ☾** button in the toolbar to switch between the dark industrial blueprint theme (default) and a light theme. The preference is not persisted between page loads.
