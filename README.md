# Odoo Inventory Flow Visualiser

> A visual designer for Odoo inventory workflows — warehouses, locations,
> operation types, routes, rules, putaway rules, storage categories — with
> live two-way sync to running Odoo instances.

**© 2026 Dinsdag BV.** Proprietary software. See [LICENSE](LICENSE).

This Module is the intellectual property of **Dinsdag BV** (Belgium).
It is licensed for use to Konu BV (KBO BE 0795.567.175) and its end-customer
deployments under a separate Use Agreement; third-party use requires a
Dinsdag-issued EULA stacked on top of the Odoo Proprietary License v1.0.
See [LICENSE](LICENSE) for the full terms.

---

## What it does

A single-page React app that lets consultants and customers **visualise,
edit, and round-trip** the entire `stock.*` configuration of an Odoo 17 / 18 /
19 instance. It loads/saves via the standard Odoo JSON-RPC interface — no
custom server modules required for the standalone build.

### Core capabilities

| Feature | What it does |
|---|---|
| **Canvas** | Drag-and-drop visual editor for warehouses, locations, op-types, routes, rules, putaway rules. Auto-layout via route-grouped Sugiyama tier algorithm with center-axis shared nodes. |
| **Drill-in views** | Right-click → drill into a warehouse OR a location's sub-tree. Breadcrumb navigation. Esc returns to main canvas. |
| **Sub-locations** | Real graph nodes with parent pointers (`location_id`). Up to 50 levels deep. Cycle-safe. |
| **Storage categories** | First-class registry with `allow_new_product`, `max_weight`, `capacity_qty`, and per-product `capacity_ids` overrides. Modal CRUD + inline editor in PropPanel. |
| **Putaway simulator** | Punch in product + qty, see traced resolution (rule match → location → strategy → capacity check). Pure function `simulatePutaway()`. |
| **Warehouse-preset wizard** | Add → Warehouse opens a wizard mirroring Odoo's flag cascade (reception_steps, delivery_steps, manufacture_steps, buy/manufacture_to_resupply, resupply_wh_ids). Auto-generates locations, op-types, routes, rules with `__autoGen` provenance tags. Live-regenerates on flag edits with shrink-detection dialog. |
| **Multi-company** | Filter by company; per-entity `company_id` round-trips with Odoo. |
| **Live Odoo I/O** | Fetch from / push to a running Odoo via JSON-RPC. Diffs computed against a snapshot. |
| **Multi-format export** | SVG, PNG, PDF, JSON, Markdown handover doc, Miro JSON, Visio `.vsdx` (Miro-import-ready). |
| **Huge-warehouse UX** | Sized for DRBB-class deployments (38 warehouses / 23k locations). Standard/Advanced UI mode toggle. Viewport-virtualised render, cluster mode at low zoom, named viewports, perf overlay. |

### Codebase stats

| Module | Lines | Purpose |
|---|--:|---|
| `odoo-inventory-flow (2).jsx` | 6,460 | Main React component — canvas, panels, modals, fetch/push logic |
| `src/warehouse-presets.js` | 559 | Pure-function preset generators + diff algorithm |
| `src/vsdx-exporter.js` | 282 | Visio `.vsdx` writer (inline ZIP, no deps) |
| `src/putaway-simulator.js` | 186 | In-browser Odoo putaway resolution algorithm |
| `src/markdown-exporter.js` | 149 | Project-handover doc generator |
| `src/miro-exporter.js` | 132 | Miro REST API v2 item-payload generator |
| `src/location-tree.js` | 73 | Tree helpers (children, descendants, ancestors, cycles) |
| `src/warehouse-presets.test.mjs` | 558 | 41-test pure-module test suite |

---

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- A modern browser (Chrome / Firefox / Safari / Edge — current versions)
- Optional: a running Odoo 17 / 18 / 19 instance with API key access

## Installation

```bash
npm install
npm run build      # builds dist/odoo-inventory-flow.html (single self-contained file)
```

## Usage

### Standalone (offline editing only)

```bash
open dist/odoo-inventory-flow.html
```

The app loads a sample `Full Demo Warehouse` setup. Edit, export, re-import.

### With live Odoo connection

```bash
npm run proxy      # starts http://localhost:4173
```

The proxy server forwards JSON-RPC calls to your Odoo instance, sidestepping
browser CORS restrictions. Configure URL / DB / username / API key in the
visualiser's settings (cog icon, top-right).

### Embedded inside the Konu Tools Odoo module

`addons/konu_tools/` provides a server-side controller that injects the
visualiser into Konu's own Odoo at `/konu_tools/visualiser/<connection_id>`,
forwarding RPC through Odoo's authenticated session. See the module README
for the connection-registry workflow.

## Tests

```bash
npm run test:presets   # 41 pure-module tests, ~1s
```

The pure modules (`warehouse-presets`, `location-tree`, `putaway-simulator`,
`markdown-exporter`, `miro-exporter`, `vsdx-exporter`) are zero-dependency
and tested via a tiny node:assert harness. UI is browser-tested manually.

## Project tracking

- [`CHANGELOG.md`](CHANGELOG.md) — feature timeline, version-by-version
- [`TIMESHEET.md`](TIMESHEET.md) — hours per feature for cost-of-build
- [`docs/superpowers/specs/`](docs/superpowers/specs) — design docs per feature
- [`docs/superpowers/plans/`](docs/superpowers/plans) — implementation plans

## Authorship & IP

This Module was authored by **Brecht Soenen** (Dinsdag BV) between
**2026-03-31** and the present. Every commit carries the `Dinsdag BV`
copyright header (see top of `odoo-inventory-flow (2).jsx`,
`src/main.jsx`, and every file under `src/`).

**Konu BV is a licensee, not the author.** Konu deploys this Module to its
own end-customers under the terms of the Dinsdag BV ↔ Konu BV Module Use
Agreement; intellectual-property rights remain exclusively with Dinsdag BV.

For licensing enquiries: `brecht@dinsdag.be`.
