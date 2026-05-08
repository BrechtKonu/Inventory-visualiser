# Warehouse-preset wizard — design

**Date:** 2026-05-08
**Author:** Brecht (with Claude)
**Scope:** When the user clicks *Add → Warehouse*, open a wizard that mirrors Odoo's `stock.warehouse` configuration flags and auto-generates the supporting locations / operation types / routes / rules. The wizard handles both initial creation and subsequent live edits to the warehouse's flag fields, with cleanup-confirmation when shrinking.

**Constraint:** all output bundles must keep working identically — `dist/odoo-inventory-flow.html` (standalone) and `addons/konu_tools/static/src/bundle/odoo-inventory-flow.html` (Odoo module). The build script writes both; this feature changes nothing about that.

---

## Goal

Reproduce Odoo's auto-cascade: when a warehouse is configured with `reception_steps=three_steps`, `delivery_steps=pick_pack_ship`, `manufacture_to_resupply=true`, `manufacture_steps=pbm_sam`, `buy_to_resupply=true`, and `resupply_wh_ids=[other]`, Odoo auto-creates ~10 locations, ~10 picking types, and ~5 routes. The visualiser today requires the user to drag and configure all of that by hand. This wizard does it in one click.

## v1 scope (locked, max-scope chosen)

In:
- `reception_steps` (1/2/3) — generates Input, QC locations, receive picking types, receive route
- `delivery_steps` (1/2/3) — generates Packing, Output, pick/pack/delivery picking types, PPS route
- `manufacture_to_resupply` + `manufacture_steps` (mrp_one_step / pbm / pbm_sam) — generates Pre-Prod (and Post-Prod for pbm_sam), Production, MO picking types, Manufacture route
- `buy_to_resupply` — generates Buy route
- `resupply_wh_ids` — generates Transit location(s), inter-warehouse picking types, Resupply route(s) per source warehouse
- **Live regeneration** when these fields change on an existing warehouse (via property panel), with detect-orphans-and-warn UX on shrink
- **Optional "Create in Odoo" mode** — when a live Odoo connection is configured, offer a button that creates the warehouse server-side and re-imports the result, so Odoo's own auto-cascade is the source of truth (with mandatory confirmation gate)

Out (deferred, can be follow-up specs):
- Custom location hierarchies (`WH/Stock/Shelf A/Bin 1` etc. — see roadmap item 4)
- Storage categories / capacity (roadmap item 4)
- Multi-company `lot_stock_id` semantics
- Importing existing Odoo warehouse configurations and reverse-engineering the flags (would be a separate "import & match" pass; here we only generate)

---

## Architecture

The feature has four units, each with one job:

### 1. `presetGenerator` — pure function, no React

Signature:
```
presetGenerator(input) → { addNodes, addOperationTypes, addRoutes }
```

`input`:
```
{
  warehouseId: 'wh-xyz',          // id of the warehouse being configured
  warehouseCode: 'WH2',           // 1-5 char prefix used for new location names
  warehouseName: 'Secondary WH',
  flags: {
    reception_steps: 'three_steps',
    delivery_steps: 'pick_pack_ship',
    manufacture_to_resupply: true,
    manufacture_steps: 'pbm_sam',
    buy_to_resupply: true,
    resupply_wh_ids: ['wh1'],     // ids of source warehouses (must exist on canvas)
  },
  existingNodes,                   // current canvas nodes — used to detect Vendors/Customers
                                   // for reuse and to id-prefix new nodes uniquely
}
```

Output: arrays of new entities ready to merge. Each generated node has `__autoGen = { warehouseId, source }` where `source ∈ { 'reception_steps', 'delivery_steps', 'manufacture', 'buy', 'resupply:<src_wh_id>' }`.

**Reuse logic** (recommended choice from brainstorm Q3):
- If `existingNodes` already contains a `usage='supplier'` node, reuse it (don't create another Vendors).
- Same for `usage='customer'`.
- Production locations (`usage='production'`) are always per-warehouse — generate a new one, prefix-named (`<code>/Production`).
- All internal locations (`<code>/Input`, `<code>/Stock`, etc.) are always per-warehouse.

**ID prefixing**: new entity ids are `<warehouseId>-<short>` (e.g. `wh2-input`, `wh2-rl-recv-1`). Guarantees uniqueness when the canvas has multiple warehouses.

This unit is a pure function — easy to unit-test, no DOM, no setState. It becomes the core building block.

### 2. `presetDiff` — pure function, no React

Signature:
```
presetDiff(currentData, warehouseId, newFlags) → {
  toAdd:    { nodes, operationTypes, routes },
  toRemove: { nodeIds, opTypeIds, routeIds, ruleIds, putawayRuleIds },
  externalRefs: [{ orphanId, referencedBy: [...] }]
}
```

Computes the difference between the warehouse's current `__autoGen`-tagged nodes and what `presetGenerator` would produce for the new flags. Crucially, it uses the **provenance tags** to scope the diff to one warehouse — it never proposes removing nodes the user added manually or that another warehouse owns.

The `externalRefs` array catches the dangerous case: if reception_steps is being shrunk to 1 and `WH/Quality Control` is auto-tagged for removal, but a manually-added rule still references `WH/QC` as its source, that rule would lose its src on removal. This array surfaces those references so the warning dialog can show them.

### 3. `WizardModal` — React component

A new modal component (alongside `AddModal`, `CfgModal`, etc.). Two modes:

**Create mode** — user clicks `Add → Warehouse`:
- Shows a single form with progressive disclosure: code, name, then routings (reception/delivery dropdowns), then booleans (manufacture, buy) which when checked reveal sub-options (manufacture_steps).
- Resupply uses a multi-select chip picker over existing warehouses. Disabled if canvas has 0 other warehouses.
- Footer: `[Skip — just add empty WH]` `[Cancel]` `[Create]`. Skip falls back to today's behaviour (single empty node).
- Smart-suggest defaults: code = `WH` if no warehouse exists, else `WH<n>` where n is one more than the current warehouse count; name = `<code> Warehouse`.
- **Live preview panel** on the right: lists the locations / op-types / routes that will be created. Updates as user toggles options. No animation, just text.

**Edit mode** — user changes a wizard-managed field on an existing warehouse via the property panel:
- The property panel intercepts changes to `reception_steps`, `delivery_steps`, `manufacture_to_resupply`, `manufacture_steps`, `buy_to_resupply`, `resupply_wh_ids`.
- It calls `presetDiff(...)`. If `toAdd` is non-empty and `toRemove` is empty (pure grow), apply silently with an undo entry.
- If `toRemove` is non-empty (shrink, or off-toggle), show a confirmation dialog with the orphan list. Three options: Delete all orphans / Keep but mark inactive / Cancel.
- "Keep inactive" sets `active=false` on each orphan and tags `__autoGen.deactivated=true`. (The renderer will need a small "show inactive" toggle in the sidebar — already on the roadmap as part of this feature.)
- "External refs" show in the warning with their referencing rule ids; user must read+confirm before delete.

### 4. `mergeWizardOutput` — small dispatcher

Takes the `addNodes / addOperationTypes / addRoutes` output and pushes it through the existing `setData(p => ...)` history-aware pattern (so undo/redo work). Then triggers `autoLayout()` and `fitToContent()` (with the same setTimeout dance the templates code uses today).

For removals, it filters out `nodeIds`, `opTypeIds`, `routeIds`, etc. from the relevant arrays in `data`.

---

## Data model change

Every node, operation type, route, and rule that the wizard generates carries:

```
__autoGen: {
  warehouseId: 'wh1',
  source: 'reception_steps' | 'delivery_steps' | 'manufacture' | 'buy' | 'resupply:<wh_id>'
}
```

This is a non-data, structural field — round-trips via the JSON export. Existing exports without this field continue to load fine (the field is treated as missing → "user-created").

The `presetDiff` function lives or dies on this tag. If it's missing, the diff will assume the user created the location manually and will never propose to remove it — safe degradation.

---

## Sequencing inside `presetGenerator`

Generation order matters because rules reference op-types which reference locations. Algorithm:

1. **Locations.** For each `flags` value, append the locations the value implies (with reuse for Vendors/Customers from `existingNodes`). Push them in flow order so their default x-positions form a sensible left-to-right strip; auto-layout will refine.
2. **Operation types.** With locations now id-resolvable, generate the op-types each route needs.
3. **Routes + rules.** Last. Each rule cites src + dst location ids and a picking type id, all resolved from steps 1+2.
4. Cross-route references (e.g. the Manufacture route uses the Stock location that the receive_steps route also feeds into) work because Stock is one of the locations generated up front and shared across routes for that warehouse.

For resupply specifically — the two `__autoGen` fields play different roles:

- `warehouseId` says **which warehouse the entity belongs to** (where it would live in Odoo's warehouse tree).
- `source` says **which configuration flag created it**, used as the diff key on shrink.

For a resupply target → source relationship `target.resupply_wh_ids = [source]`, the wizard generates:

| Entity | `warehouseId` | `source` |
|---|---|---|
| Transit location (lives in target's tree) | `<target>` | `resupply:<source>` |
| Target-side IN picking type (`Receipts from <source>`) | `<target>` | `resupply:<source>` |
| Source-side OUT picking type (`Send to <target>`) | `<source>` | `resupply:<target>` |
| Resupply route on target | `<target>` | `resupply:<source>` |

When the user removes `source` from `target.resupply_wh_ids`, the diff queries for `source ∈ {'resupply:<source>'}` AND `warehouseId == target` (catches Transit, IN op-type, route) PLUS `source == 'resupply:<target>'` AND `warehouseId == source` (catches OUT op-type). Two complementary queries, one for each side of the relationship.

---

## Smart name/code suggestions (overlap with roadmap item 6)

Inside the wizard:
- **Code** suggestion: `WH` if no other warehouse on canvas, else `WH${count + 1}`. Editable.
- **Name** suggestion: `Main Warehouse` if first, else `Secondary Warehouse`, `Tertiary Warehouse`, `Warehouse 4`, `Warehouse 5`, …
- **Sequence_code** for picking types: derived from warehouse code: `IN`, `QC`, `STO`, `PICK`, `PACK`, `OUT`, `MO`, `PC`, `SFP`, `BUY`. Where the warehouse is non-default, prefix: `WH2-IN`, `WH2-PICK`, etc. (Odoo doesn't actually prefix sequence codes, but on a multi-warehouse canvas the user needs them distinguishable; we make this an explicit visual choice.)

These suggestions are pre-filled values — the user can override any of them in the wizard.

---

## Optional: "Create in Odoo" mode (nice-to-have)

When the visualiser has a live Odoo connection (proxy active and credentials saved in `apiCfg`), the wizard surfaces a third creation mode alongside *Create* and *Skip*:

```
[Skip — empty WH]   [Cancel]   [Create locally]   [Create in Odoo]
                                                  ─────────────────
                                                   ⚠ writes real
                                                     records
```

**What it does:**
1. POST `stock.warehouse.create({code, name, reception_steps, delivery_steps, manufacture_to_resupply, manufacture_steps, buy_to_resupply, resupply_wh_ids})` via the existing `/odoo-proxy` `call_kw` channel.
2. Odoo's own `_create_or_update_route` cascade generates the actual locations, picking types, routes, rules — version-correct for that specific Odoo version.
3. Re-fetch the new entities (filtered to the new warehouse) using the same fetch path as today's *Fetch* button.
4. Merge the fetched entities into the canvas, tagging each with `__autoGen = { warehouseId: <new>, source: <inferred> }`. Source-inference uses the route name / location name pattern (e.g. a location ending in `/Quality Control` → `source: 'reception_steps'`).
5. Run auto-layout + fit-to-content, same as the local path.

**Why this is valuable:** Odoo's cascade differs subtly between versions (17/18/19 each rearrange a few defaults). Using Odoo as the source of truth gives us free version-correctness. It's also faster to maintain — when Odoo 20 changes something, the local generator falls behind, the Odoo path keeps working.

**Why it's optional:**
- Standalone HTML (`file://`) and offline mode have no proxy → button is hidden.
- Writing a real warehouse to a customer's production DB is a category of mistake we don't want to make trivial. The button is greyed out for connections marked `mcp_exposed=false`/`production=true` (a hint we can read from `__KONU_CFG__` if the embed is from the Konu Tools module; for raw proxy connections we always show the warning).

**Confirmation gate before the call:**
A modal step in front of the request:
```
⚠ This will create real records in Odoo at <url> / <db>
The warehouse "Secondary Warehouse" will be inserted, and Odoo will
auto-generate ~10 locations, ~10 picking types, ~5 routes.

Proceed only on staging or in a database you're sure about.

  ☐ I understand. Create.
  [Cancel]
```

The checkbox must be ticked before the **Create** button enables. No silent push.

**Inferring `source` tags from fetched data:** location names give the strongest signal — `<code>/Input` → `reception_steps`; `<code>/Packing` → `delivery_steps`; `<code>/Pre-Production` → `manufacture`; `<code>/Transit` (or any location whose name matches `Transit.*<other_code>`) → `resupply:<other_wh_id>`. Routes and op-types inherit `source` from their dominant location involvement. Anything not classifiable falls back to `source: 'unknown'` and is excluded from shrink-detection (safe: shrink will never auto-remove an `unknown` entity).

**Out of scope for this nice-to-have:** the reverse direction ("push *changes* to Odoo when editing existing fields"). That's a 2-way-sync feature and belongs in its own spec — too many edge cases (concurrent edits, deletion semantics, rollback). The "Create in Odoo" path is one-shot creation only; subsequent edits to the warehouse stay local until the user explicitly *Pushes* via the existing API panel.

---

## Auto-layout interaction

After generation/removal, fire `autoLayout()` then `fitToContent()` (50ms `setTimeout` chain, as templates already do). The new lane-based layout we just shipped handles multi-warehouse layouts automatically — each warehouse's internals end up in their own column-group within the same lane, sorted left-to-right by tier. No additional tweaks needed.

---

## UI flow summary

```
Add → Warehouse
        │
        ▼
┌─────────────────────────────────────────────────┐
│ Wizard                                          │
│                                  ┌─────────────┐│
│  Code:  [WH2]                    │ Will create:││
│  Name:  [Secondary Warehouse]    │  WH2/Stock  ││
│                                  │  WH2/Input  ││
│  Reception:  [3 steps]  ▾        │  WH2/QC     ││
│  Delivery:   [1 step]   ▾        │             ││
│  Manufacture: ☐                  │  Operation: ││
│  Buy:         ☑                  │   Receipts2 ││
│                                  │   QC2       ││
│  Resupply from:                  │   Store2    ││
│   [+ WH (Main)]                  │   Buy2      ││
│                                  │             ││
│                                  │  Routes:    ││
│                                  │   Receive 3 ││
│                                  │   Buy       ││
│                                  └─────────────┘│
│  [Skip]            [Cancel]   [Create]          │
└─────────────────────────────────────────────────┘
```

Edit-mode shrink dialog (when changing reception_steps 3→1 on existing warehouse):

```
┌────────────────────────────────────────────────┐
│ ⚠ Reducing reception_steps 3 → 1 will orphan: │
│                                                │
│ Locations:        WH2/Input, WH2/QC            │
│ Operation types:  Receipts2, QualityCheck2,    │
│                   Store2                       │
│ Routes:           Receive 3 steps (3 rules)    │
│                                                │
│ External refs:                                 │
│   rule rl-xd1 still uses WH2/Input  ⚠         │
│                                                │
│  ○ Delete all orphans (rl-xd1 will lose src)  │
│  ○ Keep but mark inactive                     │
│  ● Cancel — don't change reception_steps      │
└────────────────────────────────────────────────┘
```

---

## Test plan

No test runner; verification is manual:

1. `npm run build` — both bundles must build clean.
2. Open `http://localhost:4173`. Click **Add → Warehouse**.
3. Create matrix:
   - Empty canvas, code=WH, recv=1, deliv=1, mfg=off, buy=off → 1 warehouse + Vendors + Stock + Customers, no routes.
   - Empty canvas, code=WH, recv=3, deliv=3, mfg=on (pbm_sam), buy=on → matches the bundled "Full Demo Warehouse" template (visually).
   - Existing canvas (Demo Warehouse already there) + add second WH (code=WH2, recv=1, deliv=1, buy=on, resupply_from=[wh1]) → Vendors + Customers reused; WH2/Stock + Transit + Resupply route created.
4. Edit matrix:
   - Created warehouse, then change reception_steps 3→1 in property panel → shrink dialog appears with WH/Input + WH/QC orphans, rule list correct.
   - Pick "Delete" → orphans removed, undo (Ctrl+Z) restores them.
   - Pick "Mark inactive" → orphans stay, faded; toggle "Show inactive" to confirm.
5. Skip path: open wizard, click *Skip — just add empty WH* → behaves like today's `Add → Warehouse`.
6. JSON round-trip: export a wizard-generated canvas, reload, import → all `__autoGen` tags survive; subsequent shrink behaves correctly.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Existing JSON exports have no `__autoGen` tags → wizard can't shrink old warehouses safely | Explicit fallback: missing `__autoGen` → never auto-remove. User must remove manually. Acceptable degradation. |
| User edits a wizard-generated location (renames, changes usage) and then later shrinks | The `__autoGen` tag persists across rename. User-edited generated nodes still get caught by `presetDiff`. If the user has "domesticated" a generated node, the shrink dialog still warns; user picks "Keep inactive" to preserve. |
| Resupply's tagging-by-target-warehouse-id is subtle | Document inline; add a unit test for the diff function with a 2-warehouse resupply scenario. (When test infra exists.) |
| Wizard preview panel slows down on big canvases | Preview is text-only and recomputes only on flag toggles, not every render. O(flags) cost. No risk. |
| Multi-step wizard might confuse users used to instant Add | Single-form layout (not multi-step), with `Skip` link prominent. Single-form keeps the modal at ~500px and feels closer to the existing AddModal. |

---

## What this design does NOT cover

- **Sub-locations** (`WH/Stock/Shelf A/Bin 1`) — separate roadmap item; would be its own brainstorm.
- **Storage categories / capacities** — separate roadmap item.
- **Importing existing Odoo data and reverse-engineering wizard state** — a 2-way sync question. The current Fetch flow imports raw warehouses + locations + routes; it doesn't tag them with `__autoGen`. If you want shrink-detection on imported warehouses, we'd need a heuristic matcher (later spec).
- **Per-product / per-category selectability flags on auto-generated routes** — defaults from the existing `_route` helper carry through (e.g. mfg routes default `product_selectable=true`).
