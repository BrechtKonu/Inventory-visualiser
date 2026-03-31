# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-file React visual designer for Odoo inventory workflows. The main component lives in `odoo-inventory-flow (2).jsx` (note the space and version suffix). A small `src/main.jsx` entry point mounts it for the standalone build.

## Commands

```bash
npm run build    # Bundle to dist/odoo-inventory-flow.html via esbuild
npm run proxy    # Start proxy server at http://localhost:4173 (required for live Odoo connection)
```

The build produces a **single self-contained HTML file** with inlined, minified JS (IIFE format, ES2020 target) — no separate assets. The build script (`scripts/build-standalone.mjs`) uses esbuild's `write: false` mode and manually wraps the output in an HTML shell.

To develop, either open `dist/odoo-inventory-flow.html` directly in a browser (offline/manual mode only) or run `npm run proxy` after building and open `http://localhost:4173`.

There are no tests and no linter configured.

## Architecture

Everything lives in `odoo-inventory-flow (2).jsx` with a single `export default function App()`.

**Theme:** All colors defined in the `T` object at the top of the file (dark industrial blueprint palette). Route edge colors cycle through `ROUTE_COLORS` (8 entries), indexed by `colorIdx` on each route.

**Central state (`data`):** Contains `nodes`, `operationTypes`, `routes`, and `putawayRules`. All updates go through `doUpdate(type, id, upd)`, `doDelete(type, id)`, and `doAdd(type)`. **State is not persisted** — it resets to `initData()` on every page load. The only persistence mechanism is the manual JSON export/import flow.

**`initData()`** defines the default sample data: a full 3-step receive / pick-pack-ship / manufacturing / crossdock warehouse scenario. It is the single source of truth for what appears on the canvas at startup.

**Layout:** Three-panel layout — left sidebar (routes/rules tree, 210px), SVG canvas (pan/zoom/drag), right sidebar (property editor, 330px).

**Canvas rendering order (SVG):**
1. Dot-grid background pattern
2. Arrow markers
3. Operation type groups (dashed bounding boxes)
4. Route rule edges (colored curved lines)
5. Nodes with ports
6. Legend

Node dimensions are fixed: `NW = 160, NH = 48`. Positions are stored as explicit `x`/`y` on each node — there is no auto-layout. The `bestPorts` function picks which side (left/right/top/bottom) to attach each edge to based on relative node positions. Bidirectional rule pairs (A→B and B→A) are detected by `buildBidirectionalMap` and offset with a perpendicular curve to prevent overlap.

**Field definitions:** `fieldDefs` object maps each entity type to an array of `{ key, label, type, options? }` entries. `key` is the Odoo model field name; these drive both the property panel and the API code generation.

**API code generation:** Two Python xmlrpc templates (fetch/write tabs) generated dynamically from current `data` and rendered in a modal. Also supports live read/write via the proxy server using Odoo JSON-RPC (`/web/dataset/call_kw`).

## Proxy Server

`scripts/proxy-server.mjs` is a plain Node.js HTTP server (no framework) that:
- Serves `dist/odoo-inventory-flow.html` at `GET /`
- Forwards Odoo JSON-RPC calls via `POST /odoo-proxy` to avoid CORS issues
- Maintains per-session Odoo cookie jars in memory (keyed by `proxy_session_id` cookie)
- Exposes `GET /health` → `{ ok: true }` for uptime checks
- Configurable via `HOST` (default `127.0.0.1`) and `PORT` (default `4173`) env vars

The app auto-detects whether to use the proxy based on origin mismatch between the app and the Odoo URL. When running from `file://`, the proxy is required (the app will warn if not).

## Export/Import Format

JSON files exported by the app have the shape:
```json
{ "version": 1, "exportedAt": "...", "data": { "nodes", "operationTypes", "routes", "putawayRules" }, "apiCfg": { "url", "db", "username", "apiKey" } }
```

## Key Odoo Entity Types

- **Warehouses** — top-level, configured with reception/delivery step counts
- **Locations** — usage types: `supplier`, `internal`, `customer`, `production`, `transit`, `inventory`
- **Operation Types** — groups of moves with source/destination locations; `code` is `incoming`/`outgoing`/`internal`
- **Routes** — named collections of rules with applicability flags (product, category, warehouse, SO, PO)
- **Rules** — pull/push supply chain rules with `action`, `procure_method`, and `auto` fields
- **Putaway Rules** — automatic storage allocation by product or category; stored in `data.putawayRules` (separate from canvas nodes), managed through a per-location panel
