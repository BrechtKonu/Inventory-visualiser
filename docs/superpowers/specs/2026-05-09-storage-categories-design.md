# Storage categories, sub-locations & capacity — design

**Date:** 2026-05-09
**Author:** Brecht (with Claude)
**Scope:** Promote sub-locations to real nodes with parent pointers, introduce a first-class storage-category registry, surface capacity (qty + packages) on locations, add a drill-in view that visualises the location hierarchy, and layer in a capacity heatmap (Odoo-fetched) plus an in-browser putaway simulator. One bundled ship.

**Constraint:** all output bundles must keep working — `dist/odoo-inventory-flow.html` (standalone) and `addons/konu_tools/static/src/bundle/odoo-inventory-flow.html` (Odoo module). The build script writes both; this feature changes nothing about that.

---

## Goal

Today the visualiser has a stub of storage-category support: a free-text `storage_category_id` field on locations, a `capacity` number field, and a small canvas badge. Sub-locations exist only as path strings (`"WH/Stock/Shelf A/Bin 1"`) on putaway rules — they're not graph nodes. There's no way to see, edit, or reason about the location tree. There's no way to define a category once and reuse it across locations. Capacity exists but has no semantic dimension (units? packages? weight?) and no rule layer that respects it.

This spec brings the model up to Odoo-grade:

1. **Sub-locations as real nodes** with parent pointers (`location_id` m2o).
2. **Storage-category registry** — first-class entities with `name`, `allow_new_product`, `max_weight`, `capacity_qty`. Locations and putaway rules reference them by id.
3. **Capacity** — split into `capacity_qty` (units of product) and `capacity_packages` (containers). `capacity` (legacy single field) stays for back-compat.
4. **Drill-in view** — right-click a location → "Open sub-locations →" opens a nested canvas at that location. Breadcrumb to navigate back. Same canvas mechanics as main, scoped to the subtree.
5. **Render layers in drill-in** — tree edges, putaway-rule colored arrows, category color regions (toggle), capacity heatmap (toggle, needs Odoo fetch).
6. **In-browser putaway simulator** — given product + qty, walk the rules sorted by sequence, apply storage_strategy, check capacity, output the resolved sub-location with status.

## Non-goals

- Auto-migrating existing path-string putaway rules to nodes. Per Brecht's choice, strings and nodes coexist; rule's m2o wins on render if both fields are set.
- Replacing or removing the legacy `location_out` string field. Backwards compatibility forever.
- Reusable category-pack templates (e.g. "ship Pallet/Bin/Cold defaults"). Future v3.
- Multi-level visual treemap inside the warehouse blob. We chose drill-in.
- Live two-way sync of quant data while editing. Fetch is a one-shot snapshot.

---

## Data model changes

### `node.data` additions (locations only)

```js
{
  // Existing fields preserved (complete_name, usage, scrap_location, replenish_location,
  //  removal_strategy, barcode, storage_category_id, capacity)

  location_id: 'wh1-shelfA',          // NEW — m2o to parent location node id, or null for top-level
  storage_category_id: 'cat-pallet',  // CHANGED — was free-text; now m2o to data.storageCategories[].id
  capacity_qty: 20,                    // NEW — max units of product
  capacity_packages: 0,                // NEW — max containers
  // capacity (legacy) — kept; treat as alias for capacity_qty when capacity_qty is undefined
}
```

The `location_id` ref is the load-bearing addition. It defines the tree implicitly: the set `{n : n.data.location_id === parentId}` is the children of `parentId`.

### `data.storageCategories` — new top-level array

```js
data.storageCategories = [
  {
    id: 'cat-pallet',
    name: 'Pallet',
    allow_new_product: 'same_product',  // 'mixed_products' | 'same_product' | 'only_empty'
    max_weight: 500,                      // kg, 0 = no cap
    capacity_qty: 1,                      // default capacity rule
  },
  { id: 'cat-bin',  name: 'Bin',  allow_new_product: 'mixed_products', max_weight: 50,  capacity_qty: 100 },
  { id: 'cat-cold', name: 'Cold', allow_new_product: 'mixed_products', max_weight: 0,   capacity_qty: 200 },
];
```

Maps 1:1 to Odoo's `stock.storage.category`. `allow_new_product` matches the model's selection field. `capacity_qty` / `max_weight` mirror the `capacity_ids` o2m on storage_category — simplified to a single default capacity per category for v1; per-product capacity rules are deferred.

### `data.putawayRules` — extend existing

```js
{
  id, location_in_id,
  location_out_id: 'wh1-stock-shelfA-bin1',  // NEW m2o
  location_out: 'WH/Stock/Shelf A/Bin 1',     // legacy string, kept for back-compat
  product, category, sequence,
  storage_strategy: 'closest_location',       // existing
  storage_category_id: 'cat-bin',              // existing — now references registry
}
```

Render rule: if `location_out_id` is set, render the m2o (look up node, show its `complete_name`). Else fall back to `location_out` string.

### Round-trip through JSON export

All new fields serialize automatically — `data.nodes`, `data.storageCategories`, `data.putawayRules` are already in the export envelope. Existing exports without `location_id` or `storageCategories` import as: top-level locations, no categories. Safe degradation.

---

## Architecture (5 units)

### Unit 1 — Tree helpers (pure)

A new tiny module `src/location-tree.js`:

```js
export function childrenOf(nodes, parentId) {
  return nodes.filter(n =>
    n.type === 'location' &&
    (n.data?.location_id === parentId || (parentId === null && !n.data?.location_id))
  );
}

export function descendantsOf(nodes, rootId) {
  const out = [];
  const visit = (id) => {
    const kids = childrenOf(nodes, id);
    out.push(...kids);
    for (const k of kids) visit(k.id);
  };
  visit(rootId);
  return out;
}

export function ancestorPath(nodes, leafId) {
  const path = [];
  let cur = nodes.find(n => n.id === leafId);
  while (cur) {
    path.unshift(cur);
    const parentId = cur.data?.location_id;
    cur = parentId ? nodes.find(n => n.id === parentId) : null;
  }
  return path;
}

export function isDescendantOf(nodes, candidateId, ancestorId) {
  const path = ancestorPath(nodes, candidateId);
  return path.some(n => n.id === ancestorId);
}
```

Pure functions, easy to test. Tested via `src/warehouse-presets.test.mjs` extensions.

### Unit 2 — Drill-in viewport state

In App: a new state `drillInto: string | null`. When set, the canvas filters its node-render and edge-render passes:

```js
const visibleNodes = useMemo(() => {
  if (!drillInto) {
    // Main canvas: show only top-level locations + warehouses + suppliers + customers
    return data.nodes.filter(n =>
      n.type !== 'location' || !n.data?.location_id
    );
  }
  // Drill-in: show direct + transitive descendants of drillInto
  const descIds = new Set(descendantsOf(data.nodes, drillInto).map(n => n.id));
  return data.nodes.filter(n =>
    n.id === drillInto || descIds.has(n.id)
  );
}, [data.nodes, drillInto]);
```

Edges rendered in drill-in: putaway rules whose `location_in_id === drillInto`, displayed as colored arrows (one per rule) ending at the matching `location_out_id` child.

Auto-layout works inside drill-in too — re-runs against `visibleNodes` only.

Toolbar gets a breadcrumb: `Main → WH → WH/Stock` with each segment clickable for level-up navigation. `Esc` returns to main.

### Unit 3 — Storage Category modal + inline editor

**Modal** (`StorageCategoryModal`): triggered from Add menu / a toolbar button / right-sidebar. Lists all `storageCategories` in a table:

```
| Name      | Allow new product   | Max weight | Capacity qty |  |
|-----------|--------------------|------------|--------------|---|
| Pallet    | same_product       | 500        | 1            | × |
| Bin       | mixed_products     | 50         | 100          | × |
| Cold      | mixed_products     | 0          | 200          | × |
| + Add row                                                     |
```

Inline edit on click. Delete with confirm. Saves via the existing history-aware `setData` path so undo works.

**Inline editor in PropPanel**: when editing a location's `storage_category_id`, the dropdown shows all categories + a "+ New category…" option that opens a tiny inline form (name, allow_new_product, max_weight, capacity_qty), creates the category, and selects it.

### Unit 4 — Drill-in render layers

Three new toggles in the drill-in toolbar (icons `⛁ ▦ ✚`):

1. **Tree edges** — always on; faint grey lines from parent center to each child center, dashed.
2. **Putaway-rule arrows** — toggle. For each putaway rule with `location_in_id === drillInto`, draw an arrow from the parent into the rule's `location_out_id` child. Arrow color = rule's stable hue (hashed from rule id, mid-saturation). Rule label rides the arrow.
3. **Storage-category color regions** — toggle. For each child node, fill its background with `hashColor(storage_category_id, 60, 50)` at 12% alpha. Like op-wash but per category.
4. **Capacity heatmap** — toggle. Each child node tinted by `current_qty / capacity_qty` ratio: green (<70%), amber (70-95%), red (>95%) or grey (no quant data). Requires Odoo fetch (Unit 5).

### Unit 5 — Quant fetch + heatmap data

Extend `handleFetchFromOdoo` to additionally fetch `stock.quant` aggregated by location:

```python
quants = sr('stock.quant',
  [('location_id', 'in', [...all internal location ids])],
  ['location_id', 'product_id', 'quantity'])
# Then aggregate per location: sum(quantity)
```

Stored in `data._quantsByLocation: Map<location_id, sum>` (NB: underscore-prefixed = transient, not persisted in JSON exports — refresh on each fetch).

Fetched only when the heatmap toggle is enabled AND a fresh fetch hasn't happened recently. Add a small "Refresh quants" button in drill-in toolbar.

### Unit 6 — Putaway simulator (in-browser)

Pure function `src/putaway-simulator.js`:

```js
export function simulatePutaway(data, ctx) {
  // ctx: { product: 'FURN_7800 Office Desk', category: 'Furniture',
  //        location_in_id: 'wh1-stock', qty: 5 }
  // Returns: { resolvedLocationId, capacityCheck: 'ok'|'over'|'unknown',
  //            steps: [...trace...], reason: '...' }
}
```

Algorithm:

1. Find putaway rules where `location_in_id === ctx.location_in_id`, sorted by `sequence` ascending.
2. For each rule, check if it matches: `(rule.product matches ctx.product) OR (rule.category matches ctx.category) OR (rule has no product+category — wildcard)`.
3. First match wins. Resolve `location_out_id` (or fallback `location_out` string — string match returns `unknown` capacity).
4. If `storage_strategy === 'closest_location'`: among the children of the matched location, pick the lowest `barcode` ASCII order (proxy for "closest" in absence of physical layout).
5. If `storage_strategy === 'least_packages'`: pick the child with lowest `current_qty / capacity_qty`. Requires quant data → falls back to `closest` if no fetch.
6. If `storage_strategy === 'manual_no_strategy'`: just return `location_out_id`.
7. Capacity check: compare `(current_qty + ctx.qty)` against `capacity_qty`. Status: ok / over / unknown.
8. Return trace: which rule matched at step 1, which child was picked at step 4-6, what the capacity says.

A small **"Test putaway"** modal in the drill-in toolbar lets users punch in product/qty/category and see the trace inline.

---

## UI flows

### Right-click → drill-in

```
Right-click WH/Stock node
  ▸ Edit
  ▸ Duplicate
  ▸ Delete
  ▸ Open sub-locations →   (NEW; only when location has children OR usage=internal)
  ▸ z-order …
```

### Drill-in toolbar

```
┌──────────────────────────────────────────────────────┐
│ ← Back   Path: Main / WH / WH/Stock                  │
│                                                       │
│ [+ Add sub-location] [⛁ Tree] [▦ Heatmap] [✚ Cats] [▶ Test putaway]
│                                                       │
│        Shelf A          Shelf B                       │
│        ├ Bin 1   ┌──┐    ├ Bin 1                     │
│        │  cap 20 │  │    └ Bin 2                     │
│        └ Bin 2   └──┘                                 │
│           ↑                                           │
│           color region: cat-bin                       │
│           heatmap: amber (16/20 = 80%)                │
└──────────────────────────────────────────────────────┘
```

### Storage Category modal

```
┌─ Storage Categories ──────────────────────────────────┐
│                                                        │
│  Name      Allow new        Max kg   Cap qty   Action  │
│ ───────────────────────────────────────────────────── │
│  Pallet    same_product ▾   500      1         ✕      │
│  Bin       mixed_products ▾ 50       100       ✕      │
│  Cold      mixed_products ▾ 0        200       ✕      │
│                                                        │
│  [+ Add category]                                      │
│                                                        │
│                                          [Done]        │
└────────────────────────────────────────────────────────┘
```

### Test-putaway modal (drill-in)

```
┌─ Test Putaway ────────────────────────────────┐
│  Product:   [Office Desk          ▾]          │
│  Category:  [Furniture            ▾]          │
│  Quantity:  [5                     ]          │
│                                                │
│  ──── Trace ────                               │
│  Step 1: matched rule pa-1 (seq=1, product=Office Desk) │
│  Step 2: location_out = WH/Stock/Shelf A/Bin 1        │
│  Step 3: strategy=manual_no_strategy → keep target    │
│  Step 4: capacity: current=14 + 5 = 19, cap=20 → OK   │
│                                                        │
│  ✓ Will place in: WH/Stock/Shelf A/Bin 1              │
│  Capacity after: 19/20 (95%)                          │
│                                                        │
│  [Try another]                          [Close]        │
└────────────────────────────────────────────────────────┘
```

---

## Interaction with the existing warehouse-preset wizard

This feature does NOT touch the wizard. The wizard continues to produce only top-level locations (Stock, Input, etc.) — sub-locations and categories are a higher-fidelity layer the user adds afterwards via drill-in.

**Future**: optional preset packs ("Apply Pallet+Bin+Cold defaults to WH/Stock") could land as a v3 follow-up but are explicitly out of this spec's scope.

---

## Round-trip with Odoo

### Fetch additions

```python
# In handleFetchFromOdoo's Python codegen template:
storage_cats = sr('stock.storage.category', [], ['name', 'allow_new_product', 'max_weight', 'capacity_ids'])
locations = sr('stock.location', [], [..., 'location_id', 'storage_category_id'])  # location_id added
putaway = sr('stock.putaway.rule', [], [..., 'location_out_id'])  # location_out_id added
quants = sr('stock.quant', [...], ['location_id', 'quantity'])  # NEW for heatmap
```

The mapping function rebuilds:
- `data.storageCategories` from `storage_cats`
- Sub-location nodes from `locations` where `location_id` is non-root
- Updated putaway rules with `location_out_id` set
- `data._quantsByLocation` map

### Push additions

The push diff (`handlePushToOdoo`) gains support for:
- New `stock.storage.category` records (model whitelist already covers this)
- Sub-location creates with `location_id` parent
- Putaway-rule updates that flip from `location_out` (string) to `location_out_id` (m2o)

Push safety: per CLAUDE.md, `stock.location` and `stock.storage.category` are NOT on the wizard whitelist. Pushes to them require the explicit "Are you sure?" gate. We'll surface this gate before any push.

---

## Test plan

The repo's pure-module tests via `npm run test:presets`. New tests:

```js
// src/warehouse-presets.test.mjs additions:
it('childrenOf: returns direct kids only', ...)
it('descendantsOf: returns transitive kids', ...)
it('ancestorPath: from leaf to root', ...)
it('simulatePutaway: closest_location strategy picks alphabetical bin', ...)
it('simulatePutaway: capacity over-fill returns over status', ...)
it('simulatePutaway: missing quants degrades to unknown', ...)
```

Aim: bring `npm run test:presets` from 25 → 31+.

Manual verification matrix:

1. Default canvas → right-click WH/Stock → "Open sub-locations" → empty drill-in (no nodes yet). Add → "Sub-location" places a child of WH/Stock with `location_id='loc-stock'`.
2. Add 3 children, edit storage_category_id via inline editor (creates category). Toggle "Cats" — backgrounds wash with category hue.
3. Toggle "Heatmap" without a fetch — all nodes grey. Trigger fetch — nodes color by current_qty/capacity_qty.
4. Run "Test putaway" with product=Desk → trace shows rule match + resolution + capacity status.
5. Export JSON, re-import → all sub-locations + categories + putaway rules survive.
6. Edit a putaway rule's `location_out_id` to a new node — main canvas continues to render correctly; drill-in shows the colored arrow.
7. Legacy putaway rules with only `location_out` string still work — drill-in skips them (they're phantom).

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Drill-in view confuses users — they don't realize they're in a different canvas | Persistent breadcrumb at top + colored frame around the drill-in canvas + "← back" button always visible. Unmistakable visual mode-switch. |
| Sub-location nodes leak into main canvas | The visibleNodes filter (Unit 2) hides any node with `data.location_id` set. Hard rule. |
| Putaway simulator gives wrong answers vs Odoo | Document explicitly: simulator is a "best-guess preview". Trust Odoo's actual algorithm for production. |
| Heatmap fetch is slow on large warehouses | Fetch only on toggle-on, with a visible spinner. Cache for the session. Add "Refresh" to re-fetch on demand. |
| Coexistence of `location_out` and `location_out_id` produces split UI | PropPanel shows both fields with a clear "preferred: m2o" hint. Render always prefers m2o when set. |
| Cycle in `location_id` chain (parent → child → parent) | `ancestorPath` gets a max-depth guard (50). Detected cycles render with a warning badge on the node. |
| Push to Odoo creates dozens of locations and storage categories | The Odoo MCP rule already requires double-confirm for `stock.location` and `stock.storage.category`. Surface this prominently in the push dialog. |

---

## What this design does NOT cover

- **Per-product capacity rules within a storage category** — Odoo's `capacity_ids` is an o2m of `(product, qty)` pairs. We're simplifying to a single `capacity_qty` per category for v1. Per-product rules deferred.
- **Reusable category packs** ("install Pallet/Bin/Cold defaults") — defer.
- **Real-time sync** — heatmap is a snapshot. No subscription/polling.
- **Bulk operations** — no "select 20 sub-locations and batch-edit category". One-at-a-time only for v1.
- **Sub-locations as `src/dst` of regular `stock.rule` records** — sub-locations are pickable ONLY for putaway rules' `location_out_id` (with a tree-grouped dropdown). Regular pull/push/manufacture rules stay top-level only on the main canvas. Sub-location-level routing in the main canvas is deferred.
- **Drag a sub-location from drill-in to main canvas** to "promote" it. Out of scope.
