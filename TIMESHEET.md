# Timesheet — Cost-of-Build Report

> Per-feature hour estimates for the Odoo Inventory Flow Visualiser.
> Used for: cost-recovery pricing to end-customers, valuation of the IP,
> change-order quoting on customer-specific extensions.

**Author:** Brecht Soenen (Dinsdag BV)
**Period covered:** 2026-03-31 → 2026-05-09 (current)
**Methodology:** Hours estimated from commit graph, design doc length,
spec/plan complexity, and feature scope. Senior consultant blended rate
applied uniformly. Adjust the rate for B2B-vs-internal pricing.

> **Important:** Hours below count **author time** (Brecht Soenen).
> AI-assisted (Claude) execution time is excluded — it does not bill.
> What's recorded is the design + decision-making + review effort that
> only a human author can perform.

---

## Rate cards (€)

| Type | Rate | Notes |
|---|--:|---|
| Senior consultancy / architecture | €150/hr | Spec-writing, brainstorming, design decisions |
| Implementation review | €120/hr | Code review, manual testing, integration |
| Documentation / handover | €90/hr | README, changelog, customer briefings |
| **Blended rate (default)** | **€130/hr** | Used for line-items below |

For internal-cost reporting use **€95/hr** (loaded employee rate) instead.

---

## Phase 1 — Foundation (2026-03-31 → 2026-05-08)

| # | Feature | Hours | Cost @ €130 |
|--:|---|--:|--:|
| 1 | Initial scaffolding, single-file React canvas, theme | 8 | €1,040 |
| 2 | Basic node editing, drag, port-based rule creation | 12 | €1,560 |
| 3 | Sugiyama auto-layout v1 (longest-path + barycenter) | 14 | €1,820 |
| 4 | DFS cycle detection for back-edges | 4 | €520 |
| 5 | SVG / PNG / PDF export | 6 | €780 |
| 6 | Op-blob with leader-line callouts (later replaced) | 8 | €1,040 |
| 7 | Property panel + field schema (warehouse / location / op / route / rule / putaway) | 16 | €2,080 |
| 8 | Live Odoo I/O — fetch / push / proxy server / diff against snapshot | 24 | €3,120 |
| 9 | Konu Tools Odoo module — controller + RPC bridge + connection registry + encrypted API keys | 18 | €2,340 |
| 10 | Op-label auto-placement (8-direction collision-aware) | 6 | €780 |
| 11 | Z-order, undo/redo, multi-select, lasso, keyboard shortcuts (foundation set) | 10 | €1,300 |
| | **Phase 1 subtotal** | **126 h** | **€16,380** |

## Phase 2 — Auto-layout overhaul (2026-05-09)

| # | Feature | Hours | Cost @ €130 |
|--:|---|--:|--:|
| 12 | Spec: route-grouped tier auto-layout with center-axis | 3 | €390 |
| 13 | Implementation: lane assignment, shared-node detection, drift damping | 6 | €780 |
| | **Phase 2 subtotal** | **9 h** | **€1,170** |

## Phase 3 — Warehouse-preset wizard (Plan A)

| # | Feature | Hours | Cost @ €130 |
|--:|---|--:|--:|
| 14 | Brainstorming + spec doc (warehouse-preset-wizard-design.md, 309 lines) | 4 | €520 |
| 15 | Implementation plan doc (1,810 lines, 14 tasks) | 3 | €390 |
| 16 | Pure module: reception_steps generator + tests | 2 | €260 |
| 17 | Pure module: delivery_steps generator + tests | 2 | €260 |
| 18 | Pure module: manufacture generator (3 sub-modes) + tests | 3 | €390 |
| 19 | Pure module: buy generator + tests | 1 | €130 |
| 20 | Pure module: resupply generator with two-sided tagging + tests | 4 | €520 |
| 21 | Top-level orchestrator (Stock/Vendors/Customers/Warehouse identity) | 2 | €260 |
| 22 | WizardModal UI (form, smart defaults, m2m picker, live preview, Create) | 6 | €780 |
| 23 | mergeWizardOutput dispatcher + history-aware setData wiring | 2 | €260 |
| 24 | Manual verification matrix + bug fixes | 2 | €260 |
| | **Phase 3 subtotal** | **31 h** | **€4,030** |

## Phase 4 — Plan B (live regen + shrink dialog)

| # | Feature | Hours | Cost @ €130 |
|--:|---|--:|--:|
| 25 | Pure module: presetDiff with two-sided resupply awareness + 3 tests | 4 | €520 |
| 26 | Property-panel intercept on wizard-managed flag edits | 2 | €260 |
| 27 | ShrinkDialog (orphan list + external refs + 3 resolutions) | 4 | €520 |
| 28 | Show-inactive sidebar toggle with canvas dimming | 2 | €260 |
| | **Phase 4 subtotal** | **12 h** | **€1,560** |

## Phase 5 — Wave 3 polish (May 2026)

| # | Feature | Hours | Cost @ €130 |
|--:|---|--:|--:|
| 29 | Drag warehouse blob with contents (group drag) | 2 | €260 |
| 30 | Templates append mode with id-remapping + Vendors/Customers dedup | 3 | €390 |
| 31 | Op-type viz rework (pills + wash + 3 modes + multi-pill stacking) | 8 | €1,040 |
| 32 | Markdown setup-export tool | 2 | €260 |
| 33 | Push-rule domain helper + 28 categorized presets | 3 | €390 |
| 34 | Odoo 19 source cross-check on presets (move.filtered_domain semantics) | 2 | €260 |
| 35 | Drag-anywhere with Alt + 6 new keyboard shortcuts | 2 | €260 |
| 36 | Right-click → New Warehouse opens wizard | 1 | €130 |
| 37 | Op-pills + wash fade with route/rule selection | 1 | €130 |
| | **Phase 5 subtotal** | **24 h** | **€3,120** |

## Phase 6 — Storage categories + sub-locations

| # | Feature | Hours | Cost @ €130 |
|--:|---|--:|--:|
| 38 | Brainstorming + spec doc (storage-categories-design.md) | 3 | €390 |
| 39 | Pure module: location-tree (children/descendants/ancestors/cycles) + tests | 2 | €260 |
| 40 | Pure module: putaway-simulator (rule walk + strategy + capacity) + tests | 3 | €390 |
| 41 | Data model extensions (location_id, capacity_qty, capacity_packages, storage_category_id m2o) | 2 | €260 |
| 42 | Drill-in viewport + breadcrumb | 4 | €520 |
| 43 | Drill-in render layers (tree edges, putaway arrows, category regions, heatmap) | 4 | €520 |
| 44 | StorageCategoryModal (CRUD + per-product capacity_ids inline table) | 3 | €390 |
| 45 | TestPutawayModal in drill-in | 2 | €260 |
| 46 | Odoo quant fetch + heatmap wiring | 2 | €260 |
| 47 | Sample data overhaul: 5 sub-locations under WH/Stock with categories | 1 | €130 |
| 48 | Sub-locations as src/dst of stock.rules (option A: parent-remap + badge) | 3 | €390 |
| 49 | Per-product capacity rules in simulator + UI + 2 tests | 2 | €260 |
| | **Phase 6 subtotal** | **31 h** | **€4,030** |

## Phase 7 — Huge-warehouse UX (sized for DRBB: 38 wh / 23k loc / 9,865 putaway)

| # | Feature | Hours | Cost @ €130 |
|--:|---|--:|--:|
| 50 | DRBB handover doc analysis + benchmark capture | 1 | €130 |
| 51 | nodeById Map memo for hot edge render | 1 | €130 |
| 52 | Typeahead m2o dropdowns at >30 options | 1 | €130 |
| 53 | Multi-company filter (registry + dropdown + render filter + per-entity company_id fetch) | 4 | €520 |
| 54 | Viewport memo + virtualised node/edge render | 3 | €390 |
| 55 | Cluster mode at low zoom (grid-bin + click-to-zoom) | 4 | €520 |
| 56 | Auto-layout perf cap (adaptive BC iterations) | 1 | €130 |
| 57 | Jump-to-X command palette entries | 1 | €130 |
| 58 | Sub-loc count badge with click-drill | 1 | €130 |
| 59 | Perf overlay (FPS + counts + mode) | 1 | €130 |
| 60 | Hard-filter mode (hide vs dim) | 1 | €130 |
| 61 | Standard/Advanced UI mode toggle | 1 | €130 |
| 62 | Sidebar route grouping (collapsible by colorIdx at ≥12 routes) | 2 | €260 |
| 63 | Multi-canvas named viewports (save/restore camera + filters, localStorage) | 2 | €260 |
| 64 | Sub-loc inline expand/collapse on main canvas | 1 | €130 |
| 65 | JSON export size guardrails | 1 | €130 |
| 66 | PutawayPanel collapse + filter + bulk-ops + pagination | 3 | €390 |
| 67 | Per-warehouse drill-in scope | 4 | €520 |
| 68 | Drill-in op-type pill gating (no ghost pills) | 1 | €130 |
| 69 | Sub-location rules visibility (route edges in drill-in) | 2 | €260 |
| | **Phase 7 subtotal** | **35 h** | **€4,550** |

## Phase 8 — Exports

| # | Feature | Hours | Cost @ €130 |
|--:|---|--:|--:|
| 70 | Miro JSON exporter (REST API v2 item-payload format) | 2 | €260 |
| 71 | VSDX (Visio) exporter (inline ZIP encoder, OOXML XML, no deps) | 4 | €520 |
| | **Phase 8 subtotal** | **6 h** | **€780** |

## Phase 9 — Documentation & project tracking

| # | Feature | Hours | Cost @ €130 |
|--:|---|--:|--:|
| 72 | CLAUDE.md project memory (architecture, conventions, roadmap) | 4 | €520 |
| 73 | Spec docs under docs/superpowers/specs/ (3 specs, ~700 lines) | 3 | €390 |
| 74 | Implementation plan under docs/superpowers/plans/ (1,810 lines) | 3 | €390 |
| 75 | README + CHANGELOG + this TIMESHEET | 3 | €390 |
| | **Phase 9 subtotal** | **13 h** | **€1,690** |

---

## Grand totals

| | Hours | Cost @ €130 | Cost @ €95 internal |
|---|--:|--:|--:|
| **Total project** | **287 h** | **€37,310** | **€27,265** |
| **Replacement-cost upper bound** (€150 senior rate) | 287 h | **€43,050** | — |

### Breakdown by phase

| Phase | Hours | % of total |
|---|--:|--:|
| 1 — Foundation | 126 | 43.9% |
| 2 — Auto-layout overhaul | 9 | 3.1% |
| 3 — Wizard Plan A | 31 | 10.8% |
| 4 — Wizard Plan B | 12 | 4.2% |
| 5 — Wave 3 polish | 24 | 8.4% |
| 6 — Storage categories | 31 | 10.8% |
| 7 — Huge-warehouse UX | 35 | 12.2% |
| 8 — Exports | 6 | 2.1% |
| 9 — Documentation | 13 | 4.5% |
| **Total** | **287** | **100%** |

---

## Pricing implications for end-customer deployments

### Per-customer fixed price

A reasonable end-customer fixed price covers:
- Module installation + first connection setup: **2 h** (€260)
- Per-warehouse fetch + initial review: **0.5 h × number_of_warehouses**
- One round of guided edits + push-back to Odoo: **2-4 h** depending on scope

For a customer like DRBB (38 warehouses), a guided onboarding works out to
roughly **€3,000 – €5,000** as a one-shot fixed-price engagement. Subsequent
self-service use sits on the EULA seat fee.

### Per-seat / per-database EULA

The EULA covers one Odoo database belonging to one legal entity. Recommended
indicative pricing (subject to negotiation):

| Tier | Use case | Annual fee |
|---|---|--:|
| **Studio** | <5 warehouses, <500 locations | €1,500 |
| **Professional** | 5-20 warehouses, <5k locations | €4,500 |
| **Enterprise** | 20+ warehouses, 5k+ locations (DRBB-class) | €12,000+ |

Pricing assumes Brecht Soenen has invested **~€37k worth of senior-consultant
time** in building the IP. A 3-year amortisation on 30+ Studio licences,
or 10+ Professional licences, recovers cost. Enterprise tier is bespoke.

### Customer-specific extensions

Customer-specific features (e.g. DRBB's `max_volume` field, customer-specific
push-rule domains, custom warehouse presets) are **not covered by the EULA**
and are billed separately at the implementation rate (€120-150/hr depending
on scope).

---

## Update procedure

This document is updated:
1. **At every minor release** — append a new feature line to the relevant phase.
2. **At every quarter-end** — recalculate totals, review rate cards.
3. **At any customer-specific extension** — log the customisation hours
   under that customer's account, NOT against this document's totals
   (those track core-IP time only).

Maintained by Brecht Soenen.
Latest update: 2026-05-09.
