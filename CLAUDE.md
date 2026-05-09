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

`source ∈ { 'identity', 'reception_steps', 'delivery_steps', 'manufacture', 'buy', 'resupply:<wh_id>' }`. `identity` = the warehouse + its Stock + Vendors/Customers. The flag-driven sources tag everything generated from a specific configuration toggle. Round-trips through the JSON export. Used by Plan B (shrink-detection on field edits).

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

Eight features shipped overnight on `main`. The pure-module test suite is at **25 passing** (`npm run test:presets`). Both bundles rebuild cleanly.

- ✅ **Auto-layout: route-grouped tier layout with center-axis shared nodes** — each route gets a numeric `laneRank` from its action signature; nodes shared by multiple routes auto-pin to the center axis. Constants: `Y_CENTER=400`, `LANE_GAP=110`, drift only fires for genuinely linear chains.
- ✅ **Warehouse-creation presets — Plan A (creation flow)** — wizard for `Add → Warehouse` with reception/delivery/manufacture/buy/resupply flags. Pure-function generators in `src/warehouse-presets.js`. Provenance via `__autoGen = { warehouseId, source }` round-trips through JSON. Smart code/name defaults (`WH<n>`, `Main/Secondary/Tertiary Warehouse`). Resupply m2m chip picker shown when canvas has ≥1 existing warehouse. Live preview panel.
- ✅ **Warehouse-creation presets — Plan B (live regen + shrink dialog)** — editing `reception_steps`/`delivery_steps`/`manufacture_to_resupply`/`manufacture_steps`/`buy_to_resupply`/`resupply_wh_ids` on an existing warehouse intercepts via `presetDiff`. Pure grow applies directly with undo. Shrink opens `ShrinkDialog` with orphan list + external-rule references. Three resolutions: Cancel / Delete orphans / Keep but deactivate (`active=false` + `__autoGen.deactivated=true`). "Show inactive" sidebar toggle dims deactivated entities to opacity 0.4.
- ❌ **Warehouse-creation presets — Plan C (Create in Odoo)** — **dropped from scope.** A scaffold existed at worktree `worktree-agent-a109b0e7415c5da2d` (kept as a safety net, no longer in active development). Reasoning: the workflow is already covered two ways — (a) build with the in-app wizard then push via the existing Odoo write path, or (b) create the warehouse in Odoo's own UI and pull it back via Fetch. A dedicated "Create in Odoo" button adds a third way that needs its own reconciliation logic for marginal benefit.
- ✅ **Push-rule domain helper** — `domain` field on rules in PropPanel. Textarea + 6 preset insert buttons (`has QC route`, `stock in location`, `has product tag`, `product category`, `on sale`, `is purchasable`) plus a "Wrap in [...]" button.
- ✅ **Putaway storage strategies** — `storage_strategy` (manual_no_strategy / closest_location / least_packages) and `storage_category_id` surfaced per putaway rule. `storage_category_id` also added to location field schema. Generated API code includes the new fields in fetch templates.
- ✅ **Templates append mode** — every template card now has Replace + "+ Add" buttons. Add merges with id-remapping (`tXXXX-` prefix) and dedupes shared semantic locations (Vendors/Customers map to existing canvas nodes). One undo step.
- ✅ **Drag warehouse blob with contents** — dragging a warehouse node now drags all its child locations as a rigid group (children identified by `complete_name` prefix OR `__autoGen.warehouseId` tag). Op-type blobs follow automatically because their endpoints moved. Heavier stroke on the blob during drag for visual feedback. Disabled when multi-select is active to avoid double-handling.
- ✅ **Storage categories + capacity** — sub-location nested-canvas view, drill-in, capacity-based putaway simulator, per-product `capacity_ids` from storage category, multi-level trees as real nodes (`location_id` parent pointers, up to 50 levels). Shipped in `30302de`.
- 🟡 **Sequence numbers on import** (partial) — `backfillSequences()` helper auto-fills missing putaway `sequence` (`(i+1)*10`) and op-type `sequence_code` (3-char prefix from label initials) on both JSON-import and Odoo-fetch paths. **Tail-end work pending: must first read Odoo source (`stock.warehouse._compute_xxx_sequence_id`, `stock.picking.type._default_sequence_code`) to map exact behaviour, then pick — warehouse `code` autogen rule, route `sequence` priority semantics, sequence_code collision resolution, whether to render sequence on canvas.**
- ✅ **Miro export** — JSON shipped in `be7850d`; VSDX (the Miro-import-ready path that actually works) shipped in `5565954`.

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

#### ❌ Export tool: Excel for Odoo import — **dropped from scope (2026-05-09)**

Originally proposed as an alternate path into Odoo. Dropped because the
existing **Push to Odoo** flow (live JSON-RPC writes against the running
instance) covers the round-trip case, and the **Markdown export** covers
human-readable handover. An Excel/CSV intermediary adds an external-id
strategy to maintain (`__import__.<canvas_id>` vs slugified) and a
mixed-source-canvas merge story for marginal benefit. If a customer
specifically asks for an offline-import bundle, revisit then.

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

#### Next-up scope (priority order, refreshed 2026-05-09 evening)

1. ✅ **MD export** — landed 2026-05-09.
2. ✅ **Push-rule domain preset additions** — landed 2026-05-09. Source verified (`/tmp/odoo19/`).
3. ✅ **Storage categories deep dive** — shipped in `30302de`.
4. ✅ **Seed data with sub-loc rules + push+domain example** — shipped (Cold-Chain push rule + Fast Pick sub-loc-as-src rule with weight domain).
5. **Sequence numbers — research-then-map** (small) — read Odoo source (`stock.warehouse`, `stock.picking.type._default_sequence_code`) first to map exact behaviour, then decide what to surface in the canvas. **Up next.**
6. **Push-blob neighbour avoidance** (small) — flag-only highlight on drop (option 4 from the proposed approaches); no auto-shove.
7. **Putaway-centric viz** (medium) — see "Putaway/Storage-categories dedicated view (proposal needed)" below.
8. ❌ **Excel/CSV Odoo import** — dropped; Push to Odoo + MD export cover the workflows.
9. ❌ **Miro REST integration** — dropped; VSDX export already gives Miro a working import path.

### Roadmap wave 3 (captured 2026-05-09 morning, post-Q&A)

Items from the user's morning pass:

#### ✅ Landed in this commit

- **Drag from anywhere** — Alt+drag (or middle mouse button) pans the canvas, even over nodes. Help-modal updated.
- **Right-click → New Warehouse opens the wizard** instead of placing an empty warehouse node.
- **Op-types fade with route/rule selection** — when a route or rule is selected, the op-pill and op-wash for unrelated ops dim to opacity 0.18 (pills) / fillOpacity 0.02 (wash). The rule-selection highlight now also computes `opIds` so pills can fade alongside edges.
- **Slightly bigger location-name font** — 13 → 15 on canvas labels; usage sub-label 9 → 10.
- **More keyboard shortcuts**: `Ctrl+S` save (export JSON), `Ctrl+O` open (import JSON), `1`/`2`/`3` cycle op-viz mode, `L` auto-layout, `0` fit-to-content. Help modal reflects all new shortcuts.
- **MD export** — pure module `src/markdown-exporter.js`; toolbar Export menu + command-palette entry.
- **Push-rule preset expansion** — 28 presets across Product properties / Move source / Triggering doc / Special cases. Collapsible categories in the picker. Field-accuracy comment in source flags Odoo-source verification as still pending.

#### 🟦 Roadmap deferred (with proposals)

- **Push warehouse-blob neighbours away on drag** — picked **option 4** (flag-only highlight). On drop, AABB-check non-children of the dragged warehouse against the moved set; flash overlapping non-children in red for ~600ms and let the user decide. No auto-shove. Options 1/2/3 (soft repulsion / hard collision avoidance / lane reflow) recorded for posterity but not on the roadmap.

- ✅ **Multi-company support** — shipped in `c9f24ef` and `be7850d`. Per-entity `company_id` round-trips with Odoo; toolbar filter dims everything outside the selected set.

- ✅ **Push-rule domain proposals — Odoo source cross-check (done 2026-05-09)** — Odoo 19 source was at `/tmp/odoo19/` (not `~/odoo/19.0/`). Critical finding from `stock_move.py` line ~1145: `move.filtered_domain(literal_eval(rule.push_domain))`. Domain runs against `stock.move` records DIRECTLY. **All `move_id.X` prefixes were wrong** — fixed in commit batch with this note. Confirmed-existing fields: `product_id`, `partner_id` (line 93), `location_id`, `location_dest_id`, `priority`, `route_ids`, `picking_id`, `production_id`/`raw_material_production_id` (mrp), `purchase_line_id` (purchase_stock), `sale_line_id` (sale_stock), `picking_id.carrier_id` (delivery), `origin_returned_move_id`. Module-dependent presets are documented inline so users know which addon must be installed for each.

### Roadmap wave 4 (captured 2026-05-09, post-storage-categories)

#### ✅ Sub-locations as `src/dst` of regular `stock.rule` records

Shipped in `30302de` using approach **A** (parent-render + sub-loc badge on main, real sub-edge in drill-in). Seed data showcases this — `route-replenish` (Storage→Picking), `route-cold-chain` (QC→Cold push with domain), `route-fastpick` (Picking Stock→Packing pull with weight domain).

#### ✅ Per-product capacity rules within a storage category (`capacity_ids` o2m)

Shipped in `30302de`. Putaway simulator + StorageCategoryModal both consume the o2m; `data.storageCategories[i].capacity_ids` round-trips through JSON export.

#### 🟦 Per-product `capacity_ids` fetch from Odoo (later phase)

`fetchInventoryFromOdoo` still reads `stock.storage.category` with name + allow_new_product + max_weight only — the o2m fetch is on a TODO. Snippet:

```python
cats = sr('stock.storage.category', [], ['name', 'allow_new_product', 'max_weight', 'capacity_ids'])
caps = sr('stock.storage.category.capacity', [('storage_category_id', 'in', [c.id for c in cats])],
          ['storage_category_id', 'product_id', 'product_uom_id', 'quantity'])
# Group caps by storage_category_id → assemble capacity_ids per category
```

Best-effort; degrade silently if the model is absent. Not on the immediate roadmap.

#### ✅ Improved example data — sub-locations + sub-loc rules

Shipped 2026-05-09 evening. Five sub-locations under `WH/Stock` (Bulk, Storage, Picking, Cold, Returns) each with `storage_category_id`. Three demo routes exercising sub-locations:

- `route-replenish` — Storage Stock → Picking Stock (pull MTS, internal transfer)
- `route-cold-chain` — QC → Cold Room (push with `use_expiration_date` domain, sub-loc dst)
- `route-fastpick` — Picking Stock → Packing (pull MTO with `weight < 5kg` domain, sub-loc src)

Putaway rules use a mix of `location_out_id` (modern m2o) and `location_out` (legacy string) styles to demonstrate coexistence. Storage categories carry per-product `capacity_ids` examples for Pallet and Bin.

#### 🟦 AI tool integration

Open-ended: integrate AI assistance directly into the visualiser. Possible directions (pick after Brecht's brainstorm):

1. **"Explain this setup"** — given the current canvas, produce a plain-English description (warehouse layout, key flows, bottlenecks). Reuses the markdown-exporter output as input to an LLM call. Off-canvas summary panel.
2. **"Suggest improvements"** — LLM reads the canvas + Odoo best-practice corpus, suggests structural improvements (e.g. "you have a 3-step delivery but no QC route — add one?"). Surfaces as a new sidebar card.
3. **"Generate from prompt"** — natural-language → wizard config. User types "set up a warehouse for a perishable food retailer with cold-chain QC" and the AI fills the warehouse-preset wizard form. Conversational creation.
4. **"Find bug / inconsistency"** — heuristic + LLM check for common misconfigurations (orphan rules, contradictory route flags, unreachable locations, capacity rules referencing missing categories).
5. **"Putaway domain helper"** — LLM-assisted domain composition: user describes intent in English ("only for hazmat in cold zone"), AI proposes the Odoo domain expression.
6. **Two-way Odoo MCP** — when the user has an Odoo instance configured, the AI can query/modify it through the existing proxy. Ties this tool into the broader agentic-engineering setup.

Auth: API key in `apiCfg` extended with an LLM provider section. Privacy: never auto-send canvas data; always behind an explicit user action.

Effort estimate: a small slice (one of the 6 above) is ~1 day. Full integration is a multi-week thread. **Brainstorm before coding** — too many design choices to default sensibly.

### Roadmap wave 5 (captured 2026-05-09 evening)

#### ✅ Sub-locations connected by a rule auto-show on main canvas

Sub-locations referenced as `src_location_id` or `dest_location_id` of any
`stock.rule` are now automatically visible on the main canvas — no need to
expand-inline or drill in. Memo: `ruleConnectedSubLocs`. The rule-edge
remap (was always walking up to the top-level ancestor for visible-endpoint
purposes) now skips the walk if the sub-loc is already visible, so the
edge draws directly to the sub-loc and the `[sub-loc]` badge isn't shown.

#### ✅ Sub-loc → parent visual connector

Every visible sub-location (rule-connected, pinned, or under an
inline-expanded parent) draws a faint dashed line from its anchor to
its nearest visible ancestor's anchor. Pure decoration: makes the
parent-child relationship legible without forcing drill-in. Stroke =
`T.borderLight` at 0.35 opacity, dashed `3 4` at scale. Skipped in
drill-in modes (those have their own layout cues — tree edges +
breadcrumb).

#### ✅ Per-sub-location pin toggle (`data.pinned`)

Right-click any sub-location → **Pin to main view** / **Unpin from main
view**. Pinned sub-locations show on the main canvas regardless of rule
references. Field is exposed in the PropPanel too (`pinned` boolean).
The combined visibility set is `visibleSubLocs` = (inline-expanded
parents' children) ∪ (rule-connected) ∪ (pinned).

#### ✅ Pan UX — Ctrl+drag and Ctrl/Shift+wheel

- **Ctrl+drag (anywhere)** — primary pan binding, works over nodes too.
  Joins the existing Alt+drag, middle-click, and Space+drag bindings.
  Cmd+drag also works on Mac (`metaKey`).
- **Ctrl+wheel** — vertical pan (deltaY in screen pixels).
- **Shift+wheel** — horizontal pan. Uses `deltaX` if the mouse reports it,
  falls back to `deltaY` otherwise so a regular wheel still pans.
- Plain wheel still zooms at cursor — unchanged.

Help modal text updated.

#### ✅ Sidebar show/hide toggles + auto-fit on narrow viewports

For narrow / split-screen viewports where the toolbar got cut off and the right sidebar overlapped the canvas:

- Two toggles at the very-left of the toolbar (so they stay visible if the toolbar overflows): hide/show left sidebar and hide/show right sidebar (PropPanel). Both persisted in localStorage.
- Toolbar gets `overflowX: auto` so it can be horizontally scrolled when items don't fit, instead of clipping at the right edge.
- Left sidebar uses `display: none` when hidden; canvas `marginLeft` tracks the toggle so the canvas reclaims the full width.
- PropPanel render is gated on `rightSidebarVisible` so the user can dismiss it without losing selection. Width caps at `100vw` so it can't exceed the viewport on tiny screens.
- Defensive overflow rules in the build template: `html, body, #root` get `overflow: hidden` + `width: 100%` so nothing spills outside the viewport. App root uses `width: 100%; height: 100vh; maxHeight: 100%`.
- **NB**: an earlier attempt set the App root to `width: 100vw` and added an auto-compact / auto-hide-sidebars resize listener — both were reverted. `100vw` includes the vertical-scrollbar gutter on Windows browsers (~17px), and the auto-compact made icons appear "bigger" because labels disappeared. Manual control via the explicit toggles + the existing `⇲ compact` button is enough.

#### ✅ Sub-loc → parent visual connector (current commit)

Every visible sub-location (rule-connected, pinned, or under an inline-expanded parent) draws a faint dashed line from its anchor to its nearest visible ancestor's anchor. Pure decoration: makes the parent-child relationship legible without forcing drill-in. Stroke = `T.borderLight` at 0.35 opacity, dashed `3 4` at scale. Skipped in drill-in modes.

#### ❌ Putaway dedicated view — reverted

A first cut at a separate putaway-centric canvas (`3d32e0b`) was reverted in `7e6d65a` — the result didn't match Brecht's intent for what "categories + putaway as primary entities" should feel like. The PutawayPanel inside sub-loc drill-in + putaway fields in PropPanel remain the only putaway surfaces. **Note**: that commit also fixed a real bug where `doUpdate('putaway_rule', …)` mistakenly mapped over `data.nodes`. The revert restored the bug; if a putaway-rule edit ever needs to flow through `doUpdate` (currently it doesn't — PutawayPanel uses its own writer), this needs revisiting. Worth noting for the next attempt at a dedicated putaway view.

### Reference scale benchmark — DRBB (Dreambaby)

The canonical "huge warehouse" customer used to size the visualiser. Real Odoo
export numbers (from the project handover doc):

| Metric | Count |
|---|---|
| Companies | 36 (1 main + 35 branches) |
| Warehouses | 38 |
| Locations | 23,053 |
| Operation types | 412 |
| Routes | 85 |
| Stock rules | 605 |
| Putaway rules | 9,865 |
| Storage categories | 16 |
| Largest single zone | 3,528 locations (DC/Stock/Circuit/11M) |
| Reception steps mix | older shops 2-step, newer shops 1-step |

Key shape observations that drove design:

- **Hierarchical naming** — `A-M-K-101-0` (region-section-corridor-column-level). Sub-locations are deeply nested; the drill-in view scales to this naturally.
- **Circuit vs Reserve split by level** — levels 0-3 are circuit (picking), 4-6 are reserve (pallet). Same physical column splits via `removal_priority`.
- **Storage categories drive bin geometry** — 16 categories like `CIRCUIT P8` (1.97 m³ pallet), `CIRCUIT S2` (0.104 m³ shelf bin). Category capacity is BY VOLUME, not just qty — a custom field `max_volume` on `stock.storage.category` per the project's `drbb_inventory` module.
- **Putaway rules are mostly category-based** — 9,826 of 9,865 rules (99.6%) match by product category, not specific product. Per-category rule sets average ~6 rules each (1,125 categories × 6).
- **Multi-company is per-shop branch** — DC + XXL + 35 shop branches all in one Odoo instance; routes/rules/locations carry `company_id` so company-filter is essential.

Every commit touching scale-sensitive code should ask: "does this still work at 23k locations?" The cluster mode + virtualised render shipped in `aa6fad9` are sized for this.

#### ✅ UI/UX for huge warehouses (DONE — Standard/Advanced split)

Built incrementally as features land. Quick wins shipped in commit `30302de`:

**Architecture:** All advanced controls hide behind a Standard/Advanced UI mode toggle (top toolbar, persisted in localStorage). Standard = simple-warehouse user, just the canvas + basic toolbar. Advanced = power-user with perf overlay, hard-filter mode, named viewports, sidebar route grouping. The toggle only adds complexity for users who need it.

**Shipped:**
- ✅ Sub-locations hidden from main canvas by default; only render in drill-in. 500-bin warehouses don't bloat the main view.
- ✅ `nodeById` Map memo replaces hot-path `data.nodes.find(...)` calls in edge render. At 500 nodes, saves ~100k string comparisons per render.
- ✅ Typeahead m2o dropdowns when option count > 30. Datalist-backed input lets the browser narrow matches as you type. Falls back to native `<select>` for small lists.
- ✅ Multi-company filter (only renders when >1 company) dims everything outside the selected set.
- ✅ **Viewport-based virtualised render** — viewport rect memoised on scale/offset; nodes whose AABB doesn't intersect (with NW margin) are skipped. Threshold = 80 nodes; below, full render. Edges similarly skipped when both endpoints are off-screen.
- ✅ **Cluster mode at low zoom** — when scale<0.32 and virtualisation is on, nodes are grid-binned (220px world cells) and rendered as one bubble per cell with count + click-to-zoom-and-pan-into-bin.
- ✅ **Auto-layout perf cap** — Sugiyama BC iterations 12→6→3 above 200/500 nodes.
- ✅ **Jump-to-X palette entries** — Go to Location / Warehouse / Operation entries in the command palette pan-and-select; auto-drills-in if target is a sub-location.
- ✅ **Sub-loc count badge** — locations with children show `+N` (or `−N` when expanded inline) accent pill near top-right; click drills in, shift/right-click expands inline.
- ✅ **Sub-location collapse / expand inline** — main canvas hides sub-locations by default but the user can expand individual parents inline (state in `expandedInline`). Drill-in remains the primary path.
- ✅ **Perf overlay** (Advanced) — fps + entity counts + scale + viewport size + virt/cluster/full mode. Off by default.
- ✅ **Hard-filter mode** (Advanced) — when a route/rule is selected, hide non-related nodes entirely instead of dimming.
- ✅ **Standard/Advanced UI mode toggle** — `◇ std` / `◆ adv` button in toolbar, persisted via localStorage.
- ✅ **Sidebar route grouping** (Advanced) — auto-groups routes by colorIdx into collapsible sections when ≥12 routes. Search bypasses grouping.
- ✅ **Named viewports** (Advanced) — save current scale + offset + drillInto + selectedCompanies + hideUnused + opVizMode as a named view. Persisted in localStorage. Toolbar dropdown to switch.
- ✅ **JSON export size guardrails** — exports >1000 nodes use unindented JSON. Size >5MB shows a confirm before download. `_quantsByLocation` runtime cache stripped from export.

**Out of scope (deferred to specific roadmap items):**
- PutawayPanel collapsed-by-default (#65) — different surface, separate task.
- Per-warehouse drill-in scope (#66) — sized for DRBB's 38 warehouses.
- max_volume on storage categories (#67) — DRBB-specific.

#### ✅ PutawayPanel collapsed-by-default (DRBB-driven, DONE)

DRBB has 9,865 putaway rules. The current PutawayPanel renders all rules of a location as one flat list when that location is selected. At 100+ rules per location it becomes a wall. Proposed:

- Collapse-by-default per location, with a header showing rule count.
- Sort by `sequence` ascending.
- Inline filter at top: "filter by product/category/storage_category…".
- Pagination at >50 rules per location: render first 30, "show all" link.
- Bulk operations: "select all", "shift sequence by N", "set storage strategy on selected".

Effort: ~half day. Cross-cutting with the per-product capacity ui already shipped.

#### ✅ Per-warehouse drill-in scope (DRBB-driven, DONE)

DRBB has 38 warehouses on one canvas. Even with virtualisation, comprehension benefits from "scope to one warehouse at a time". Proposed:

- Right-click a warehouse → "Open warehouse →" (parallel to "Open sub-locations →" on locations).
- Drill-in shows ONLY entities tagged `__autoGen.warehouseId === <id>` OR linked by route_id whose `warehouse_selectable=True` AND has this warehouse on `data.warehouse_ids` OR via per-entity `data.warehouse_id`.
- Breadcrumb: "Main / Warehouse: DB Brugge".
- Combines with company filter — drill-in respects current company selection.
- Esc returns to main canvas.

Effort: ~1 day. Strongly complementary to multi-company filter.

#### ❌ max_volume on storage categories — **dropped from scope (2026-05-09)**

DRBB-only customisation; standard Odoo's `stock.storage.category` has `max_weight`, not volume. Generalising the visualiser around a single customer's overlay isn't worth the field-schema bloat. If DRBB needs the custom field surfaced for their export, it goes in a customer-specific overlay (similar to how customer-specific push-rule presets would be handled), not in the core schema.

#### 🟦 Putaway-/storage-categories-centric dedicated view (proposal)

The current canvas is **route/rule-centric** — routes drive the colouring,
rules are the edges, op-types are the pills. Putaway rules and storage
categories are second-class: they live in the PutawayPanel + the
StorageCategoryModal, and the canvas only hints at them via location
badges.

For warehouses where putaway is the dominant configuration burden (DRBB:
9,865 putaway rules vs 605 stock rules — 16× more), the
route/rule view is the wrong primary lens. Proposed: a parallel
**"Putaway view"** mode (toolbar toggle, alongside Standard/Advanced),
where:

| Aspect | Route/rule view (today) | Putaway view (proposed) |
|---|---|---|
| Canvas primary entities | Locations, op-type pills | Locations, **storage categories as labelled regions/zones** |
| Edges | `stock.rule` (pull/push/manufacture) | `stock.putaway.rule` (input → output) |
| Edge colour | by route `colorIdx` | by storage strategy (`manual_no_strategy` / `closest_location` / `least_packages`) |
| Sidebar (left) | Routes + rules | **Storage categories** (with capacity heatmap) + putaway rule sequence |
| Sidebar (right) | Rule PropPanel | Putaway rule PropPanel |
| Drill-in | Sub-locations | Sub-locations + which putaway rule resolves there |

**Decision (2026-05-09 evening): Option A — toolbar mode toggle.** Other approaches recorded for posterity but not on the roadmap.

| # | Approach | Description |
|---|---|---|
| **A** ✅ | **Mode toggle on the toolbar** — `[Routes/Rules] [Putaway]` segmented control. Same canvas, rebound. | Cheapest. One canvas, two interpretations of the same data. |
| B | **Split-screen / tabbed** — top half routes/rules, bottom half putaway, synchronised pan. | Comparison-friendly but tight on screen real estate. |
| C | **Separate route under `/putaway` URL** — full-page dedicated view with its own state. | Cleanest mental model, most work — needs its own command palette, viewport state, etc. |

Implementation sketch for **A**:
1. Add `viewMode: 'flow' | 'putaway'` to canvas state, default `'flow'`. Toolbar button toggles.
2. In `'putaway'`:
   - Hide `stock.rule` edges and op-type pills.
   - Render putaway-rule edges instead: from `location_in_id` (top-level) to `location_out_id` (sub-loc, with badge if drill-in is needed).
   - Edge thickness scales with `sequence` priority (lower = thicker).
   - Edge colour by `storage_strategy`.
   - Left sidebar swaps from routes-tree to a storage-categories tree (each category lists its capacity stats + which locations carry it). Selecting a category dims edges/locations not tagged with it.
   - Right sidebar swaps RulePropPanel for PutawayRulePropPanel (already exists in PutawayPanel; promoted to right rail).
3. Drill-in still works: into a location → show its sub-tree + the putaway rules that resolve there + capacity heatmap by sub-location.
4. The `simulatePutaway` modal remains the primary "trace it" tool — its trace highlights the matching edge in the new view.

Open questions (to answer before coding):
- **Storage categories as zones?** Should categories render as coloured background regions (like a heatmap) under the locations they're attached to, or just as a sidebar list with locations linked? The first is more visual but adds layout cost.
- **Capacity overlay** — visualise capacity utilisation (from `_quantsByLocation` cache) as a fill bar inside each location, or only on demand (hover/select)?
- **Path-string migration** — if a putaway rule still uses `location_out` (legacy string) without `location_out_id`, render it dimly to flag that it should be migrated, or skip silently?

Note: the older "auto-migration: path-string → real sub-location nodes" idea
(which was opt-out at brainstorming time) folds naturally into this view —
the "migrate" affordance becomes a one-click action on each legacy rule
when surfaced in the new view.

Effort: A is ~1-2 days; B is ~half-day extra layout; C is ~3-4 days.

#### Code audit (no changes — proposals only)

A scan of the current state surfaces these maintenance items:

1. **`odoo-inventory-flow (2).jsx` is ~5000 lines.** It's grown past comfortable single-file size. Proposed split:
   - `src/canvas/` — SVG render layers (nodes, edges, pills, washes, blobs).
   - `src/panels/` — PropPanel, PutawayPanel, ApiPanel, sidebars.
   - `src/modals/` — AddModal, WizardModal, ShrinkDialog, ConfirmModals, HelpModal.
   - `src/state/` — App-level state hooks (history, drag, selection, viewport).
   - Main file becomes a ~200-line orchestrator. Risk: large refactor; defer until next major feature.

2. **Dead op-blob code** is hidden behind `{false && ...}` since the op-viz rework. Lines ~4337+ and the auto-layout's `labelDx/Dy` computation. Should be removed in a cleanup pass; ~150 lines.

3. **`hashColor`, `dashFor`, `nodeVisual`, `bestPorts` and several helpers** appear in TS-noisy diagnostics as "declared but never read" but ARE used (or were used). A cleanup pass should grep each and either rewire or delete.

4. **Plan C worktree** (Create-in-Odoo) is dropped from scope; the branch `worktree-agent-a109b0e7415c5da2d` is kept as an unmounted safety net but not on the roadmap. Delete the branch outright once you're sure none of its scaffolding is wanted.

5. **Test suite** (`npm run test:presets`, 46 assertions across `warehouse-presets`, `location-tree`, `putaway-simulator`, `vsdx-exporter` — all pure-module). Consider:
   - Snapshot tests for `markdown-exporter.js` (low effort, high value).
   - Unit tests for `presetDiff` edge cases (already partial — extend).
   - Playwright/Puppeteer E2E for wizard create/edit flow (medium effort, high value but heavyweight).

6. **TypeScript noise** — the project has no tsconfig but VS Code's TS server flags many issues. These are mostly cosmetic (unused imports, `labelDx` not on op-type — see (2) above). A `// @ts-nocheck` at the top of the JSX would silence them; the cleaner alternative is the file split in (1).

7. **Provenance-tag opportunity**: `__autoGen` is currently used by Plans A/B for generation/regeneration. It could ALSO inform the future Excel-export's external_id strategy (`__import__.<source>__<warehouseId>__<localId>` for wizard-generated; `__manual__.<localId>` for user-added).

8. **Single shared `data` object** is the canvas state-of-the-world, modified by ~20 different handlers. A reducer (with discriminated-union actions) would make undo/redo, history, and future collaboration features cleaner. Reducer migration is touchable in stages — wrap each `setData` site in a named action over time.
