# Changelog

All notable changes to the Odoo Inventory Flow Visualiser.

Format follows [Keep a Changelog](https://keepachangelog.com/) loosely.
Date format: ISO 8601 (`YYYY-MM-DD`). All work is by Brecht Soenen for
Dinsdag BV; commits are linked by short SHA.

## [0.7.0] — 2026-05-09 (huge-warehouse + Miro/VSDX exports)

### Added

- **Drill-in op-type pill gating** (`5ffd875` and follow-ups) — pills now
  honour drill-in scope; no ghost pills for off-screen rules.
- **Sub-location rules visibility** — drill-in renders stock.rule edges
  between sub-locations alongside tree edges and putaway arrows. Drag-from-port
  inside drill-in creates rules at sub-location level natively.
- **VSDX (Visio) exporter** — `.vsdx` writer with inline ZIP encoding (zero
  deps). Miro accepts this format via `File → Import → Visio`. Sits alongside
  JSON / Markdown / Miro-JSON exporters.
- **PutawayPanel collapse + filter** (`32b5e24`, DRBB-driven) — count in
  header, sequence-sorted, filter input at ≥10 rules, per-row + select-all
  checkboxes, bulk operations (seq shift, set strategy, delete), pagination
  at >50 rules.
- **Per-warehouse drill-in scope** (`32b5e24`, DRBB-driven) — right-click
  warehouse → drill-in filtered to entities tagged with that warehouse;
  shared types (supplier/customer/inventory) remain visible. Combines with
  company filter.
- **Standard/Advanced UI mode toggle** (`5ffd875`) — perf overlay, hard-filter,
  named viewports, sidebar route grouping all hide behind one button. Persisted
  via localStorage.
- **Sidebar route grouping** (`5ffd875`) — auto-groups by `colorIdx` into
  collapsible sections at ≥12 routes. Search bypasses grouping.
- **Multi-canvas named viewports** (`5ffd875`) — save scale + offset +
  drillInto + selectedCompanies + hideUnused + opVizMode as named view.
  Persisted via localStorage.
- **Sub-loc inline expand/collapse** (`5ffd875`) — `+N` badge on parents;
  shift/right-click expands children inline on main canvas.
- **JSON export size guardrails** (`5ffd875`) — >1k nodes use unindented JSON,
  >5MB shows confirm dialog. Strips runtime quants cache.
- **Per-entity `company_id` wiring** (`c9f24ef`) — all 6 entity fetches
  thread `company_id`. Filter works against fetched data, not just seed.
- **Cluster mode + viewport virtualisation** (`c9f24ef`) — at low zoom on
  dense canvases, grid-bins nodes into clickable cluster bubbles. Viewport
  virtualisation skips off-screen renders; threshold = 80 nodes.
- **Auto-layout perf cap** (`c9f24ef`) — Sugiyama BC iterations 12 → 6 → 3
  above 200 / 500 nodes.
- **Jump-to-X palette entries** (`c9f24ef`) — Go to Location / Warehouse /
  Operation. Pan-and-select with auto-drill-in for sub-locations.
- **Sub-loc count badge** (`c9f24ef`) — `+N` accent pill on parents with children.
- **Perf overlay + hard-filter mode** (`c9f24ef`) — toolbar toggles in
  Advanced mode.
- **`nodeById` Map memo** (`aa6fad9`) — replaces `data.nodes.find()` hot path.
- **Typeahead m2o dropdowns** (`aa6fad9`) — datalist-backed at >30 options.

### Verified

- **Odoo 19 source cross-check on push-rule presets** (`6783743`) —
  confirmed `push_domain` is evaluated against `stock.move` directly via
  `move.filtered_domain(literal_eval(...))`. Removed all `move_id.X` prefixes
  from preset expressions; added 4 new presets.

## [0.6.0] — 2026-05-09 (storage categories — full implementation)

### Added

- **Storage categories spec + pure modules** (`692749e`) — `location-tree.js`
  + `putaway-simulator.js` with 14 new tests. 39 tests passing.
- **Drill-in viewport + render layers** (`c606202`) — right-click location →
  Open sub-locations. Tree edges, putaway arrows, category color regions,
  capacity heatmap (toggle).
- **StorageCategoryModal + TestPutawayModal + Odoo quant fetch** (`cdb6833`).
- **Per-product capacity rules** (`30302de`) — `capacity_ids` o2m on storage
  categories. Per-product cap > category default > location capacity.
- **Sub-locations as rule src/dst** (`30302de`) — main canvas walks to
  top-level ancestor; dashed badge `[Sub Src › Sub Dst]` near rule midpoint.
- **Sample data with sub-locations** (`30302de`) — Bulk / Storage / Picking /
  Cold / Returns under WH/Stock with categories and capacities.
- **Miro export + multi-company support v1** (`be7850d`) — Miro REST API
  v2 item-payload generator; multi-company registry + filter dropdown.

## [0.5.0] — 2026-05-09 (op-type viz rework)

### Changed

- **Op-type visualization** (`54b3270`) — replaced overlapping blob+leader-line
  callouts with edge pills. Three modes: Pills / Pills+Wash / Hidden (hover
  reveal). Multi-pill stacking for shared edges. ~half the visual noise on
  dense canvases.

## [0.4.0] — 2026-05-09 (wave 3 polish)

### Added

- **Markdown setup-export** (`1628a08`) — project handover doc generator.
- **Push-rule domain helper** (`c968246`) — domain field on rules with 28
  preset insert buttons across 4 categories (verified vs Odoo 19 source).
- **Drag-anywhere with Alt** (`1628a08`) — Alt+drag pans canvas over nodes.
- **Right-click → New Warehouse opens wizard** (`1628a08`).
- **6 new keyboard shortcuts** (`1628a08`) — Ctrl+S/O save/open, 1/2/3 cycle
  op-viz, L auto-layout, 0 fit-to-content.
- **Op-pills + wash fade with route/rule selection** (`1628a08`).

## [0.3.0] — 2026-05-09 (Plan B — wizard live-regen)

### Added

- **Live regeneration on flag edits** (`1e86070`) — editing a wizard-managed
  flag on an existing warehouse runs `presetDiff()`. Pure grow applies; shrink
  opens a dialog with orphan list + external references + 3 resolutions
  (Cancel / Delete / Keep but deactivate).
- **Drag warehouse blob with contents** (`81e66b7`) — children move as a group.
- **Templates append mode** (`f3f757a`) — "Add to canvas" alongside Replace,
  with id-remapping and shared-location dedup (Vendors/Customers).
- **Putaway storage strategies + storage_category_id** (`b17d927`) —
  `manual_no_strategy` / `closest_location` / `least_packages` per rule.
- **Show-inactive sidebar toggle** (`7b3e1db`).
- **Minimal capacity + sequence backfills** (`f9964e1`, `7c752bb`).

## [0.2.0] — 2026-05-09 (Plan A — warehouse-preset wizard)

### Added

- **Pure preset module** (`5a1333b` → `cda0936`) — generators per flag
  with `__autoGen` provenance tags. Reception (1/2/3 step), delivery (1/2/3
  step), manufacture (mrp_one_step / pbm / pbm_sam), buy, resupply with
  two-sided tagging.
- **Top-level orchestrator** (`33e8d27`) — emits warehouse + Stock +
  Vendors/Customers (reused if present); calls each generator.
- **WizardModal scaffold** (`89448bf`) — replaces Add → Warehouse.
- **Wizard form, preview, m2m picker, Create dispatcher** (`cfcf251`) —
  smart code/name defaults, live-preview panel, history-aware merge.

## [0.1.0] — 2026-05-09 (auto-layout overhaul)

### Changed

- **Route-grouped tier auto-layout** (`1198fc2`) — replaces always-on diagonal
  drift with lane-based y placement. Each route gets a `laneRank`; nodes
  shared by multiple routes auto-pin to a center axis. `LANE_GAP=110px`,
  `Y_CENTER=400`. Drift only fires for genuinely linear chains.

## [0.0.x] — 2026-03-31 → 2026-05-08 (foundation)

Initial project setup, single-file React canvas, basic editing, Sugiyama
auto-layout with cycle handling, SVG/PNG/PDF export, Konu Tools Odoo module
(controller + RPC bridge + connection registry), op-blob with leader-line
callouts (later replaced by pills in 0.5.0).

Key foundation commits: `c45b470` (initial), `5af1a2d` (major UX overhaul),
`19b89d9` (Sugiyama layout), `c22568e` (DFS cycle detection), `9d8e336`
(op-label auto-placement).
