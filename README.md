# Odoo Inventory Flow Visualiser

A visual designer for Odoo inventory workflows — warehouses, locations, operation types, routes, rules, and putaway rules — in a single self-contained HTML file.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later

## Installation

```bash
npm install
npm run build
```

This produces `dist/odoo-inventory-flow.html` — a single file with all JavaScript inlined.

## Running

### Offline / manual mode

Open `dist/odoo-inventory-flow.html` directly in your browser. You can design and edit workflows freely, and export/import your work as JSON. No live Odoo connection is available in this mode.

### Live Odoo connection (proxy mode)

The app cannot connect to Odoo directly when opened as a local file (browser CORS restrictions). Use the included proxy server instead:

```bash
npm run proxy
```

Then open **http://localhost:4173** in your browser.

Click the **API** button in the top toolbar to enter your Odoo URL, database name, username, and API key. You can then fetch your real inventory configuration or write changes back to Odoo.

> **Note:** Proxy sessions are held in memory and are lost when the proxy server restarts.

The proxy listens on `127.0.0.1:4173` by default. Override with environment variables:

```bash
HOST=0.0.0.0 PORT=8080 npm run proxy
```

## Saving your work

State is not saved automatically — it resets to the built-in sample data on every page load. Use **Export** to save your diagram as a JSON file and **Import** to restore it later.

## API / code generation

The **API** panel generates ready-to-run Python `xmlrpc` scripts (fetch and write) based on your current diagram, so you can apply your designed configuration to a live Odoo instance.
