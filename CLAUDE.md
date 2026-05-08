# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-file React visual designer for Odoo inventory workflows. The main component lives in `odoo-inventory-flow (2).jsx` (note the space and version suffix). A small `src/main.jsx` entry point mounts it for the standalone build.

## Commands

```bash
npm install      # First-time setup
npm run build    # Bundle to dist/odoo-inventory-flow.html via esbuild
npm run proxy    # Start proxy server at http://localhost:4173 (required for live Odoo connection)
```

The build produces a **single self-contained HTML file** with inlined, minified JS (IIFE format, ES2020 target) — no separate assets. The build script (`scripts/build-standalone.mjs`) uses esbuild's `write: false` mode and manually wraps the output in an HTML shell.

**Dev loop:** there is no watch mode or dev server. Every code change requires `npm run build` before reloading the browser. To develop, either open `dist/odoo-inventory-flow.html` directly (offline/manual mode only) or run `npm run proxy` and open `http://localhost:4173`.

There are no tests and no linter configured.

## Architecture

Everything lives in `odoo-inventory-flow (2).jsx` with a single `export default function App()`.

**Theme:** All colors defined in the `T` object at the top of the file (dark industrial blueprint palette). Route edge colors cycle through `ROUTE_COLORS` (8 entries), indexed by `colorIdx` on each route.

**Central state (`data`):** Contains `nodes`, `operationTypes`, `routes`, and `putawayRules`. All updates go through `doUpdate(type, id, upd)`, `doDelete(type, id)`, and `doAdd(type)`. These helpers also push the previous state onto an undo stack (50-step Ctrl+Z/Ctrl+Y history) — bypass them and you break undo. **State is not persisted** — it resets to `initData()` on every page load. The only persistence mechanism is the manual JSON export/import flow.

**`initData()`** defines the default sample data: a full 3-step receive / pick-pack-ship / manufacturing / crossdock warehouse scenario. It is the single source of truth for what appears on the canvas at startup.

**`TEMPLATES`** is a registry of starter scenarios (`buildBlank`, `buildReceive3`, `buildPPS`, `buildMTO`, `buildBuy`, `buildMfg`, `buildXDock`, plus `default = initData()`). Each entry has `{ id, name, description, icon, build }` and is exposed via the *From Template* path inside the Add modal. Applying a template overwrites `data` (with undo history pushed) and re-runs `autoLayout` + `fitToContent`.

**Layout:** Three-panel — left sidebar (routes/rules tree, 230px), SVG canvas (pan/zoom/drag), right sidebar (property editor, 330px).

**Canvas rendering order (SVG):**
1. Dot-grid background pattern
2. Arrow markers
3. Operation type groups (rounded blob with leader-line label callouts; AABB-overlap clustering avoids label collisions)
4. Route rule edges (colored curved lines, sorted/offset by `buildEdgeOffsetMap`)
5. Nodes with ports (rendered in `z` order — see Z-order)
6. Minimap + Legend

Node dimensions are fixed: `NW = 160, NH = 48`. Positions are stored as explicit `x`/`y` on each node — auto-layout via `autoLayout()` arranges into supplier→internal→customer tiers. `bestPorts` picks the closer side per edge and `buildEdgeOffsetMap` fans out parallel/bidirectional rules with perpendicular offsets.

**Edge visual encoding (`ACTION_META`):** Per `rule.action`:
- `pull` → solid line with arrowhead
- `push` → dashed line `5 3`
- `pull_push` → dotted line `1 3`
- `buy` → solid + `$` glyph at midpoint
- `manufacture` → solid + `⚙` glyph at midpoint

A small dot at t≈0.86 along each edge encodes the procurement method: filled = `make_to_order` / `mts_else_mto` (MTO), hollow = `make_to_stock` (MTS). Umbrella rules — where `rule.dest_location_id` differs from the picking type's `dest_location_id` — render with a wider semi-transparent halo behind the line, plus an `↳` prefix on the label and an "Umbrella Rule" callout in the PropPanel.

**Z-order:** Each node and operation type carries an optional `z` integer (default 0). Render lists are sorted by `z` ascending. Helpers: `zReorder(dir)` with `dir ∈ {front, back, fwd, bwd}`. Toolbar buttons appear when something is selected; keyboard `[` / `]` cycle, `Ctrl+[` / `Ctrl+]` jump to back/front. Multi-select operations apply to all selected items.

**Keyboard shortcuts:** `Ctrl+Z`/`Ctrl+Y` undo/redo, `Ctrl+A` select all, `Esc` clear, `Del`/`Backspace` delete, arrow keys nudge 8px (Shift = 1px), `F` focus selection, `[`/`]` and `Ctrl+[`/`Ctrl+]` z-order. The handler ignores keypresses while focus is in an input/textarea/select.

**Field definitions:** `fieldDefs` object maps each entity type to an array of entries `{ key, label, type, options?, source?, hint? }`. Supported `type`s: `text`, `number`, `boolean`, `select` (with `options`), `m2o` / `m2m` (with `source: 'location'|'warehouse'|'route'|'operation_type'|...`), `ref` (free-text reference to an external Odoo record with `hint` describing the model), and `group` (section header; not an input). `key` is the Odoo model field name; these drive both the property panel and the API code generation. Coverage is aimed at Odoo 17/18/19 stock module fields.

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

- **Warehouses** — top-level, configured with reception/delivery/manufacture step counts
- **Locations** — usage types: `supplier`, `internal`, `customer`, `production`, `transit`, `inventory`, `view`. The Odoo `posx`/`posy`/`posz` fields are surfaced in the property panel for round-tripping but not used for layout (the canvas keeps its own `node.x` / `node.y`).
- **Operation Types** (`stock.picking.type`) — groups of moves with source/destination locations; `code` is `incoming` / `outgoing` / `internal` / `mrp_operation`
- **Routes** (`stock.route`) — named collections of rules with applicability flags (product, category, warehouse, packaging, SO)
- **Rules** (`stock.rule`) — pull/push supply chain rules with `action`, `procure_method`, `auto`, `delay`, group propagation, etc.
- **Putaway Rules** (`stock.putaway.rule`) — automatic storage allocation by product / category / package type / storage category; stored in `data.putawayRules` (separate from canvas nodes), managed through a per-location panel

## Provenance tags (`__autoGen`)

Entities created by the warehouse-preset wizard (`src/warehouse-presets.js`) carry an extra structural field:

```
__autoGen: { warehouseId, source }
```

`source ∈ { 'identity', 'reception_steps', 'delivery_steps', 'manufacture', 'buy', 'resupply:<wh_id>' }`. `identity` = the warehouse + its Stock + Vendors/Customers. The flag-driven sources tag everything generated from a specific configuration toggle. Round-trips through the JSON export. Used by future Plan B (shrink-detection on field edits) and Plan C ("Create in Odoo" reconciliation).

Resupply tagging is two-sided: target-side entities (Transit, IN op-type, route) tag `warehouseId=<target>, source='resupply:<source>'`; the source-side OUT op-type tags `warehouseId=<source>, source='resupply:<target>'`. This lets shrink-detection find both sides via complementary queries.

## Konu Tools Odoo module (Option E)

`addons/konu_tools/` is the **central deployment** of the visualiser. It lives
inside Konu's own Odoo, not the customer's. A `konu.customer.connection`
record stores each customer's URL/DB/login and a Fernet-encrypted API key,
tied to `res.partner` and optionally `project.project`. The Inventory
Visualiser is the first entry in the `konu.tool` catalog.

When a consultant clicks *Open Visualiser* on a connection, the controller
(`controllers/main.py`) serves the bundled HTML at
`/konu_tools/visualiser/<id>`, injecting `window.__KONU_CFG__` so the React
app routes its RPCs back through `/konu_tools/rpc/<id>` — the controller
forwards them server-side to the customer Odoo using the stored key.

`scripts/build-standalone.mjs` writes the bundle to **both** locations:

* `dist/odoo-inventory-flow.html` (standalone)
* `addons/konu_tools/static/src/bundle/odoo-inventory-flow.html` (module)

So `npm run build` covers both deployments — no separate `build:module`
needed (the alias exists for clarity).

The same connection registry is intended to back the `odoo-customer` MCP
server (KOTASK-065 Phase 2). Connections with `mcp_exposed=True` are the
ones the MCP includes in its slug list.

`api_key_input` (form-only virtual Char, group-restricted) lets admins
paste a new key; on save the model encrypts it via `set_api_key()` and
discards the plain text. The Fernet master key reads from
`KONU_TOOLS_FERNET_KEY` env var (preferred) or `ir.config_parameter`.

## Roadmap (post-audit)

Items 1–8 from the May 2026 audit are landed:
1. ✅ Push/pull visual differentiation
2. ✅ Field coverage + m2o/m2m widgets
3. ✅ Op-type blobs + leader-line labels
4. ✅ Z-order controls
5. ✅ Mixed pull/push chain rendering (umbrella detection)
6. ✅ Templates library
7. ✅ UI polish (keyboard shortcuts, minimap)
8. ⏭ Warehouse map tab — **dropped from scope** (audit-time idea; cost outweighed value once the rest landed). Posx/posy fields stay surfaced in the property panel for Odoo round-trip.
9. ✅ Konu-side Odoo module (Option E): `addons/konu_tools` — connection registry, controller, RPC bridge, encrypted API keys, audit log, partner/project ties, MCP-ready

Remaining roadmap (deferred):
- **OWL client_action wrapper** — embed the visualiser in Odoo breadcrumb chrome instead of new tab. Small wrapper over an iframe with postMessage.
- **MCP integration (KOTASK-065 Phase 2)** — point the `odoo-customer` MCP server at `konu.customer.connection` records (filter `mcp_exposed=True`).
- **Customer-side fallback module (Option A)** — for security-conscious customers who refuse to share API keys. Same React bundle, mounted in a customer-side client_action with same-origin auth.
- **API key rotation reminders** — `mail.activity` cron creating "rotate API key" follow-ups on connections with keys older than 6 months.
<<<<<<< HEAD

### Next-up scope (May 2026, captured from a single brain-dump session)

These items must work in BOTH the standalone HTML and the Odoo-module bundle (the build already writes to both — keep it that way for everything below).

- ✅ **Warehouse-creation presets — Plan A (creation only)** — wizard for `Add → Warehouse` with reception_steps / delivery_steps / manufacture (incl. manufacture_steps) / buy_to_resupply / resupply_wh_ids flags. Pure-function generators in `src/warehouse-presets.js` cascade locations + op-types + routes + rules. Provenance via `__autoGen = { warehouseId, source }` round-trips through JSON export. Smart name/code defaults bundled here (same roadmap item 6). **Plan B (live regen on field edits, with shrink-detection dialog)** and **Plan C ("Create in Odoo" mode that pushes via the proxy and re-imports)** are still pending — separate plans in `docs/superpowers/specs/2026-05-08-warehouse-preset-wizard-design.md` describe them.
- **Push-rule domain helper** — push rules in Odoo accept a domain that filters which products they apply to. Add a domain builder (free-text + presets). Preset examples to ship: "has a quality check route", "has stock in <location>", "product has tag X", "product category Y". Make these one-click "insert" suggestions, not just docs.
- **Putaway-rule storage strategies** — Odoo putaway rules support `storage_strategy` values (`closest_location`, `least_packages`, `manual_no_strategy`) and `storage_category_id`. Currently the visualiser only models product/category/sequence. Extend the per-location panel to surface strategy and category fields.
- **Storage categories + capacity + sub-location levels** — open question, needs a brainstorm session. User wants right-click on a location node → sub-location view (open a nested canvas?). Storage categories assignment, capacity numbers, multi-level location trees (`WH/Stock/Shelf A/Bin 1` is currently a string in putaway-rule output, not a real node graph). **Before coding this, run a long brainstorming pass** — user said "ask me a huge amount of questions step by step".
- **Templates: append mode** — currently applying a template overwrites `data` (with undo push). Add a second action "Add to current canvas" that merges the template's nodes/routes into the existing graph (with id remapping to avoid collisions, similar to how the warehouse-preset wizard would auto-create on top).
- **Smart name/code suggestions on create** — when adding a new location, warehouse, op-type, etc., propose a short name + code from context (e.g. new internal location under `WH/Stock` → suggest `WH/Stock/Shelf X` or pick the next free letter). Same for `sequence_code` on op-types.
- **Sequence numbers** — sequence-related fields (`sequence`, `sequence_code`, `code`, op-type `sequence_code`) are blank when importing from JSON or Odoo. Brainstorm: should they auto-fill on import? On render? Step-by-step Q&A before building.
- **Miro export/import (nice-to-have)** — warehouses → Miro frames; locations → blocks; operation types → grouped blocks with leader-line callouts; rules → arrows; routes → colour groups. Possibly use Miro's REST API + board-export JSON. Flagged as a later phase.
=======
- 🟡 **Storage categories + capacity + sub-location levels** — **partial: storage_category_id + capacity surfaced on locations, badge shown on canvas**. Brainstorming still required for: nested-canvas sub-location view, capacity-based putaway algorithm, multi-level location trees (`WH/Stock/Shelf A/Bin 1` as real node graph vs string), storage-category capacity rules. **TODO: ask Brecht the long Q&A list before extending this further.**
>>>>>>> f117da8 ([ADD] location capacity field + canvas badge for storage_category/capacity (minimal — full brainstorm pending))
