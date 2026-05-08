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

### Overnight 2026-05-08 → 2026-05-09 wave (status as of morning)

Eight features shipped overnight on `main`. The pure-module test suite is at **25 passing** (`npm run test:presets`). Both bundles rebuild cleanly. Plan C is parked at worktree branch `worktree-agent-a109b0e7415c5da2d` for review.

- ✅ **Auto-layout: route-grouped tier layout with center-axis shared nodes** — each route gets a numeric `laneRank` from its action signature; nodes shared by multiple routes auto-pin to the center axis. Constants: `Y_CENTER=400`, `LANE_GAP=110`, drift only fires for genuinely linear chains.
- ✅ **Warehouse-creation presets — Plan A (creation flow)** — wizard for `Add → Warehouse` with reception/delivery/manufacture/buy/resupply flags. Pure-function generators in `src/warehouse-presets.js`. Provenance via `__autoGen = { warehouseId, source }` round-trips through JSON. Smart code/name defaults (`WH<n>`, `Main/Secondary/Tertiary Warehouse`). Resupply m2m chip picker shown when canvas has ≥1 existing warehouse. Live preview panel.
- ✅ **Warehouse-creation presets — Plan B (live regen + shrink dialog)** — editing `reception_steps`/`delivery_steps`/`manufacture_to_resupply`/`manufacture_steps`/`buy_to_resupply`/`resupply_wh_ids` on an existing warehouse intercepts via `presetDiff`. Pure grow applies directly with undo. Shrink opens `ShrinkDialog` with orphan list + external-rule references. Three resolutions: Cancel / Delete orphans / Keep but deactivate (`active=false` + `__autoGen.deactivated=true`). "Show inactive" sidebar toggle dims deactivated entities to opacity 0.4.
- ⏸ **Warehouse-creation presets — Plan C (Create in Odoo)** — built but parked at worktree `worktree-agent-a109b0e7415c5da2d`. UI scaffold complete (button, confirm dialog with mandatory checkbox); `createWarehouseInOdoo` calls `stock.warehouse.create` via existing proxy and re-imports with `__autoGen` source-tag inference from labels. Untested against live Odoo — that's why it's parked, awaiting a staging-instance test before merge.
- ✅ **Push-rule domain helper** — `domain` field on rules in PropPanel. Textarea + 6 preset insert buttons (`has QC route`, `stock in location`, `has product tag`, `product category`, `on sale`, `is purchasable`) plus a "Wrap in [...]" button.
- ✅ **Putaway storage strategies** — `storage_strategy` (manual_no_strategy / closest_location / least_packages) and `storage_category_id` surfaced per putaway rule. `storage_category_id` also added to location field schema. Generated API code includes the new fields in fetch templates.
- ✅ **Templates append mode** — every template card now has Replace + "+ Add" buttons. Add merges with id-remapping (`tXXXX-` prefix) and dedupes shared semantic locations (Vendors/Customers map to existing canvas nodes). One undo step.
- ✅ **Drag warehouse blob with contents** — dragging a warehouse node now drags all its child locations as a rigid group (children identified by `complete_name` prefix OR `__autoGen.warehouseId` tag). Op-type blobs follow automatically because their endpoints moved. Heavier stroke on the blob during drag for visual feedback. Disabled when multi-select is active to avoid double-handling.
- 🟡 **Storage categories + capacity** (partial) — `capacity` numeric field added to locations; canvas shows monospace badge below internal locations when `capacity` or `storage_category_id` is set. **Sub-location nested view, capacity-based putaway algorithm, multi-level location trees still pending — needs the long Q&A pass.** TODO comments in code mark the location.
- 🟡 **Sequence numbers on import** (partial) — `backfillSequences()` helper auto-fills missing putaway `sequence` (`(i+1)*10`) and op-type `sequence_code` (3-char prefix from label initials) on both JSON-import and Odoo-fetch paths. **Warehouse `code` autogen, route `sequence` semantics, prefix-collision resolution, in-canvas sequence display still pending — needs Q&A.**
- ⏸ **Miro export/import** (nice-to-have) — explicitly deferred. Warehouses → Miro frames; locations → blocks; rules → arrows; routes → colour groups. To be tackled in a future pass.

### Brainstorming-pending items for the next session

These two need step-by-step Q&A before deeper implementation:

1. **Storage categories deep dive** — sub-location nested-canvas view (right-click → drill in?), capacity-based putaway (when full, fall through to next strategy), multi-level location trees as real nodes vs path strings, storage-category-on-warehouse vs on-location.

2. **Sequence numbers deep dive** — warehouse-code autogen (collision-free?), route sequence semantics (do they affect priority?), what to do when generated sequence_codes collide (e.g. "Quality Check" and "Quick Customs" both → "QCC"?), whether to render sequence on the canvas.

### Files changed

- `odoo-inventory-flow.jsx (2)` — main file, ~+500 lines for the wave
- `src/warehouse-presets.js` — pure module, generators + presetDiff
- `src/warehouse-presets.test.mjs` — 25 standalone Node tests
- `package.json` — `test:presets` script
- `docs/superpowers/specs/2026-05-08-warehouse-preset-wizard-design.md`
- `docs/superpowers/specs/2026-05-08-route-grouped-tier-layout-design.md`
- `docs/superpowers/plans/2026-05-09-warehouse-preset-wizard-plan-a-creation.md`
- `dist/odoo-inventory-flow.html` + `addons/konu_tools/static/src/bundle/odoo-inventory-flow.html` — rebuilt

### Roadmap wave 2 (captured 2026-05-09 morning)

Four new items added by Brecht. Documented here so future sessions pick them up.

#### 🟦 Export tool: Markdown setup document

Generate a single `.md` file describing the entire warehouse setup, suitable as project handover documentation or for client review. Triggered from a new toolbar button or `/Export → Markdown`.

**Proposed structure**:

```markdown
# Warehouse Setup — <client> — generated YYYY-MM-DD

## Warehouses
| Code | Name | Reception | Delivery | Manufacture | Buy | Resupply |
|------|------|-----------|----------|-------------|-----|----------|
| WH | Main Warehouse | 3-step (Input→QC→Stock) | 3-step (Pick→Pack→Ship) | pbm_sam | ✓ | – |

## Locations
Grouped per-warehouse with usage and properties.

## Operation Types
Per warehouse, with src→dst, sequence_code, lot/backorder/reservation behaviour.

## Routes & rules
Each route as a header, then rules in a table (action, src→dst, op-type, MTO/MTS, delay, domain).

## Putaway rules
Per-location section, listing sequence + product/category + storage_strategy + storage_category.

## Provenance
Footer noting which entities are wizard-generated vs manual (read from __autoGen).
```

Implementation: pure function in a new `src/markdown-exporter.js` module, taking `data` and returning a string. Toolbar wire-up in App. No tests required initially; add Node test if it grows complex.

#### 🟦 Export tool: Excel for Odoo import

Generate an `.xlsx` (or CSV bundle) ready to import into Odoo via the standard Import wizard. One sheet per model. Each sheet has an `id` (external_id) column and m2o references resolved by external_id.

**Sheet matrix**:

| Sheet | Odoo model | Key columns |
|-------|-----------|-------------|
| `stock.warehouse` | `stock.warehouse` | id, name, code, reception_steps, delivery_steps, manufacture_steps, manufacture_to_resupply, buy_to_resupply, resupply_wh_ids/id |
| `stock.location` | `stock.location` | id, name, complete_name, usage, location_id/id, removal_strategy_id, storage_category_id/id |
| `stock.picking.type` | `stock.picking.type` | id, name, code, sequence_code, default_location_src_id/id, default_location_dest_id/id, warehouse_id/id |
| `stock.route` | `stock.route` | id, name, sequence, product_selectable, product_categ_selectable, warehouse_selectable, sale_selectable |
| `stock.rule` | `stock.rule` | id, name, route_id/id, action, picking_type_id/id, location_src_id/id, location_dest_id/id, procure_method, auto, propagate_cancel, delay, domain |
| `stock.putaway.rule` | `stock.putaway.rule` | id, location_in_id/id, location_out_id/id, product_id/id, category_id/id, sequence, storage_strategy, storage_category_id/id |

Use a small client-side library (e.g. `xlsx` from npm — needs adding to deps) OR generate CSVs zipped together. CSV-bundle is simpler (no new dep) and the Odoo Import wizard takes CSVs natively.

**Open questions**:
- External-id naming: `__import__.<canvas_id>` or a slugified `<model>_<code>`?
- How to handle mixed-source canvases (some entities from Fetch, some manually added)? The fetched ones have real Odoo ids; the manual ones need new ones.
- Round-trip: should the import re-use the same external_ids on second export, so edits update in place?

#### 🟨 Push-rule domain preset proposals (research notes)

The push-rule domain helper (already shipped) currently ships 6 generic presets. Brecht wants targeted use-cases mined from Odoo 19's quality + stock modules. **Note**: Odoo source not available on this machine to verify; the proposals below are from general Odoo-19 knowledge and need source verification before shipping.

**Push rule** in Odoo: a `stock.rule` with `action='push'` triggers when a `stock.move` matches the rule's source location. The rule has a `domain` field evaluated against the matched moves. Common shape: `[('product_id.<field>', '<op>', '<val>')]` or `[('move_id.<field>', '<op>', '<val>')]`.

**Proposed presets to add to `DOMAIN_PRESETS`** (categorize the existing 6 + these new 14):

| # | Label | Use case | Expression |
|---|-------|----------|-----------|
| 1 | tracked product only | Lot/serial-tracked items get extra QC | `('product_id.tracking', 'in', ('lot', 'serial'))` |
| 2 | needs expiration | Perishables → mandatory QC | `('product_id.use_expiration_date', '=', True)` |
| 3 | hazmat | Hazardous goods → segregated storage | `('product_id.hazardous_storage_category_id', '!=', False)` |
| 4 | high-value | Above price threshold → QC + secure stock | `('product_id.list_price', '>', 1000)` |
| 5 | from specific vendor | Per-vendor QC requirement | `('move_id.partner_id', 'child_of', <partner_id>)` |
| 6 | for specific customer | Customer-specific routing | `('move_id.picking_id.partner_id.commercial_company_name', 'ilike', '<customer>')` |
| 7 | from category | Category-level QC | `('product_id.categ_id.complete_name', 'ilike', '<category>')` |
| 8 | tagged | Tag-driven applicability | `('product_id.product_tag_ids.name', '=', '<tag>')` |
| 9 | manufactured here | MO outputs only | `('move_id.production_id', '!=', False)` |
| 10 | from purchase order | PO receipts only | `('move_id.purchase_line_id', '!=', False)` |
| 11 | sales-driven | SO-driven moves | `('move_id.sale_line_id', '!=', False)` |
| 12 | returned from customer | Returns → QC/refurb | `('move_id.location_id.usage', '=', 'customer')` |
| 13 | direct-ship eligible | Skip storage step | `('product_id.product_tmpl_id.direct_ship_ok', '=', True)` |
| 14 | weighty | Pallet vs bin routing | `('product_id.weight', '>', 25)` |
| 15 | bulky | Volume threshold | `('product_id.volume', '>', 0.5)` |
| 16 | type=storable | Skip services | `('product_id.type', '=', 'product')` |
| 17 | active route | route active in MO/PO | `('route_ids.active', '=', True)` |
| 18 | quality alert open | Block until QA closes alert | `('product_id.quality_alert_count', '=', 0)` |
| 19 | first-receipt | Initial QC always | `('product_id.last_purchase_date', '=', False)` |
| 20 | seasonal | Date-window applicability | `('product_id.seasonal_start_date', '<=', context_today())` |

**Categorization** (for the UI — group presets in a 2-level menu):
- **Product properties** (1, 2, 3, 4, 14, 15, 16)
- **Move source** (5, 6, 7, 8)
- **Triggering doc** (9, 10, 11)
- **Special cases** (12, 13, 17, 18, 19, 20)

**Implementation note**: when adding these, restructure the current flat `DOMAIN_PRESETS` array into a `{ category: [presets] }` shape and render the picker as a dropdown with category headers. Some `<INPUT>` placeholders should be marked `<EDIT-ME>` so the user knows to swap in real values.

**Source verification still needed**: confirm in `~/odoo/19.0/odoo/addons/stock/models/stock_rule.py` and `~/odoo/19.0/enterprise/quality/` what `quality.point` triggers exist that overlap with push-rule domains. Odoo source not present on this machine — TODO when next on a workstation with Odoo cloned.

#### 🟧 Miro export — fine-tuning brainstorm (Q&A list)

Before implementing Miro export, the following decisions need answers:

1. **API surface**: Miro REST API v2 (requires per-user OAuth, write to live boards) vs Miro Board JSON (offline file format users import manually) — REST gives interactivity, JSON sidesteps auth complexity. Which?
2. **Auth pattern (if REST)**: per-user OAuth (best, but each consultant authorizes once) vs a service-account key (simpler, all writes appear from one user)?
3. **Frame mapping**: 1 warehouse = 1 Miro frame? Or all warehouses on one big frame, with sticky-note grouping?
4. **Block style**: location nodes as Miro shapes (rectangles) vs sticky notes? Color-coding by usage (supplier=teal, internal=blue, customer=violet, production=amber)?
5. **Edges**: Miro's connector or simple arrow shapes? Connectors auto-route but are slower to render at scale.
6. **Operation types**: not natively a Miro construct — render as group titles? as colored backdrops behind their src+dst? as small icons riding the edge midpoint?
7. **Routes**: separate Miro layers/tags so users can show/hide per route?
8. **Round-trip**: import-from-Miro? (Probably no — Miro layouts are not constrained, importing back would lose semantic structure.)
9. **Update vs create**: if a board already exists, does the export update in place (matching block IDs) or create a new copy?
10. **Audience**: who is this for? consultants showing clients (presentation polish matters) vs internal docs (functional content matters more)?

Given Brecht flagged this as "next phase" + "nice-to-have", target: a 1-page proposal with ASCII mockups answering 1-10, then user picks before coding.

#### Next-up scope (priority order)

When picking next, the order Brecht likely wants:

1. **MD export** (small, high-utility, no auth) — ~half-day implementation.
2. **Push-rule domain preset additions** (small) — half-day, mostly UI. Verify against Odoo source first.
3. **Storage categories brainstorm** (medium) — needs the long Q&A pass before any code.
4. **Sequence numbers brainstorm** (small Q&A).
5. **Excel/CSV Odoo import export** (medium-large) — requires choosing the external-id strategy.
6. **Miro brainstorm Q&A** (small Q&A), then implementation (medium-large).
7. **Plan C verification** (depends on having staging Odoo access).
