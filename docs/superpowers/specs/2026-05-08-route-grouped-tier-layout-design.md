# Route-grouped tier auto-layout — design

**Date:** 2026-05-08
**Author:** Brecht (with Claude)
**Scope:** Replace the auto-layout in `odoo-inventory-flow (2).jsx` (function `autoLayout`, ~line 2569) with a route-grouped tier layout. Keep the existing tier-and-cycle infrastructure; replace y-positioning, customer/supplier anchoring, and label-placement ordering.

---

## Problem

Looking at the current export (`odoo-inventory.json`) the layout has four real problems:

1. **No route lanes.** Receive (3-step), PPS, Manufacturing, and CrossDock all share the same Y-band. You cannot tell which nodes belong to which business process at a glance. Pre-Production (1240, 326) and Packing (1240, 426) sit ~100px apart at the same X.
2. **Customers banished 400px south of the main axis.** The current `customer_y = yMax + 100` formula plus accumulated `DIAG_DROP=55` per tier drags Customers to y=585 while the warehouse sits at y=148.
3. **CrossDock visually reads as part of the Receive flow** (same column as QC), not as the parallel bypass route it actually is.
4. **Op-type labels need very long leader lines** (e.g. `op-mo-store` has `labelDx=549`) because per-op label search is order-dependent and ops in dense tiers can't find clean space.

## Goal

A layout where **each route is a clearly visible horizontal lane**, shared locations sit on a center axis, and the X-axis still reads as time (left = upstream, right = downstream).

## Non-goals

- Warehouse-map / floor-plan layout (rejected as too radical).
- Per-route node duplication (rejected as cluttery).
- Re-architecting tier assignment, cycle detection, or barycenter crossing reduction — those work fine and stay.
- Touching the canvas, edge rendering, op-blob computation, or putaway rule UI.

---

## Approach

The new algorithm has eight phases. Phases 1, 2, 5, 6, 7, and 8 contain real changes. Phases 3 (tier + cycle handling) and 4 (barycenter ordering) are preserved from the existing implementation, with only the y-output replaced.

### Phase 1 — Lane assignment

Each route gets a numeric `laneRank`. Negative = top, 0 = center axis, positive = bottom. Computed from its rules:

A route's "chain-starts" = sources that aren't also destinations within the route's own rule set (set difference `srcs - dsts`). For recv-3 (Vendors→Input, Input→QC, QC→Stock) chain-starts = `{Vendors}`. For xdock (Input→XDock, XDock→Cust) chain-starts = `{Input}`.

```
laneRank(route) =
    +100  if any rule has action="manufacture"           // MFG always bottom
     -90  if any rule has action="buy"                   // Buy
     -50  if any chain-start is a supplier AND
          any rule ends at a customer                    // direct supplier→customer chain
    -100  if any chain-start is a supplier               // pure inbound (recv-3)
     -30  if any chain-start is in `suppliedLocs`
          (i.e. is filled-by a supplier-start rule in
           ANOTHER route) AND any rule ends at customer  // post-receive bypass (xdock)
     +50  if any rule has dst.usage="customer"           // PPS / outbound
       0  otherwise                                       // unclassifiable → center
```

Tests are evaluated in order; first match wins. The -100 branch correctly catches recv-3 because its only chain-start (`Vendors`) is a supplier, even though only the route's first rule starts at one.

Sort routes by `laneRank` ascending. Within ties, preserve `data.routes` array order (gives the user a deterministic tiebreak via sidebar ordering).

### Phase 2 — Per-node lane resolution

For each location node, compute `routesOf[nodeId]` = set of routes whose rules touch the node (as src or dst).

- `lanesTouched = unique laneRank values of routesOf[nodeId]`
- If `|lanesTouched| === 1`: the node's lane is that route's lane.
- If `|lanesTouched| > 1`: the node is a **shared node**, lane = 0 (center axis).
- If `|lanesTouched| === 0` (node touched by no routes — only by op-types): fall back to lane derived from `node.data.usage`:
  - `supplier` → -100, `customer` → +50, `production` → +100, `internal` / unset → 0.

Operation types that don't belong to any route fall under their own src/dst node lanes — they don't need their own lane bucket.

### Phase 3 — Tier assignment (UNCHANGED)

Keep the existing implementation: longest-path BFS from supplier/no-incoming sources, DFS-based back-edge detection, customer-and-inventory pinning to maxTier+1. **Lanes do not influence tier assignment** — that's the whole point: tiers = X (time), lanes = Y (process group). Orthogonal.

### Phase 4 — Within-tier ordering (UNCHANGED)

Keep the 12-pass barycenter crossing reduction. Its output is an ordered list of node IDs per tier. We use that order only to sub-sort within a lane when multiple nodes from the same lane share a tier.

### Phase 5 — Y-position by lane (NEW)

Lanes are global Y-bands. Constants:

```
LANE_GAP   = 110    // vertical spacing between adjacent lane centers
Y_CENTER   = 400    // center axis baseline
ROW_H      =  90    // within-lane stacking when multiple nodes share lane+tier
```

Convert `laneRank` → integer `laneSlot`:
- Sort distinct ranks ascending. Slot 0 = the rank closest to 0 from below or equal (center).
- Slots above center: -1, -2, … (more negative ranks → higher slots → lower y).
- Slots below center: +1, +2, …

Lane y-center for slot `k`: `Y_CENTER + k * LANE_GAP`. This guarantees every lane has the same gap and the center axis sits at exactly `Y_CENTER`.

For each tier, group its node IDs by lane:
1. For each lane present in this tier, lane has `m` nodes from this tier. Stack them vertically around the lane's y-center, sub-sorted by the Phase 4 barycenter order. Y for k-th node in lane: `lane_y - (m-1)*ROW_H/2 + k*ROW_H`.
2. After all lanes for the tier are placed, run an existing-style overlap pass within the tier: any two nodes with `|x_a - x_b| < 20` and `y_b - y_a < ROW_H * 0.95` get pushed apart. The node further from the center axis gets pushed outward (away from `Y_CENTER`); the closer node holds its position. This keeps the visual hierarchy of "shared in middle, route-specific further out" intact.

X-position of a node in tier `t`: `PAD_X + (t - tiers[0]) * COL_W` (UNCHANGED).

### Phase 6 — Damp diagonal drift (CHANGED)

Replace the always-on `DIAG_DROP = 55` with conditional drift:

```
isLinearChain = every tier has exactly 1 node AND no node has lane != 0
```

- If `isLinearChain`: apply `DIAG_DROP = 55` per tier as before. Linear chains genuinely benefit from the drift — without it they collapse to a single horizontal line.
- Otherwise: drift = 0. Lanes already provide vertical structure; drift would just bend lanes diagonally.

This single conditional kills the "Customers ends up at y=585" problem.

### Phase 7 — Customer / supplier anchoring (CHANGED)

The existing post-process forces `supplier_y = yMin - 60` and `customer_y = yMax + 100`. With lanes, that's wrong — suppliers should sit in the lane of the route that uses them.

New rule:
- Each supplier node's y = its already-computed lane y (from Phase 5). No special pull.
- Each customer node's y = same.
- Inventory-loss locations stay at the bottom (`yMax + 200`) — they're truly orthogonal to flow.

### Phase 8 — Label placement (CHANGED)

The existing per-op search is good; the problem is iteration order. Currently labels are placed in `data.operationTypes` array order. Bug: an op placed early can plant its label in space that would have been ideal for a later op, forcing the later one to use a long leader line.

Change: sort op-types before the placement loop by:
1. Tier of source node ascending (place left-to-right).
2. Then by `min(src.y, dst.y)` ascending (top-to-bottom within tier).

This way ops with already-tight space go first; ops with more options work around them. Empirically this shortens leader lines on dense layouts.

The score function itself is unchanged.

---

## Algorithm cost

- Lane assignment: O(R + Rules) where R = #routes.
- Per-node lane resolution: O(N + Rules).
- Tier + cycle + barycenter: unchanged O(N²) worst case.
- Y-positioning: O(N).
- Label placement: O(O × C) where O = #op-types and C = candidate count (~26 per op). Same as today.

No regression on layouts with up to ~100 nodes, which is well above realistic Odoo warehouse sizes.

---

## Test plan

The repo has no test runner. Verification is manual via the standalone build:

1. `npm run build`
2. Open `dist/odoo-inventory-flow.html`.
3. Run *Auto-layout* (`⊞` button) on each of the bundled templates: `default`, `buildReceive3`, `buildPPS`, `buildMTO`, `buildBuy`, `buildMfg`, `buildXDock`, `buildBlank`.
4. Visual checklist per template:
   - Inbound routes visually above the center axis.
   - Manufacturing visually below.
   - Stock (when present) sits on the center axis.
   - Customers within ±150px of the center axis (was: 400px south).
   - No two nodes overlap.
   - Op-type labels: no label crosses another op's edge or sits inside a node rectangle.
5. Import `odoo-inventory.json` (current export) and re-run auto-layout. Compare to the saved positions in the file.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `laneRank` heuristic mis-classifies a real customer route | Heuristic is data-driven from action + endpoint usage — same fields the user already maintains. If misclassification occurs, user can rearrange routes in sidebar (sort tiebreak), or override per-route `laneRank` becomes a future field. |
| Damping drift breaks linear-chain templates | `isLinearChain` check explicitly preserves drift in the linear case. |
| Label-placement reordering shifts existing label positions | Layout is recomputed every time `autoLayout` is invoked anyway. User-saved `labelDx/Dy` in JSON imports are preserved on import (existing behavior); only re-running auto-layout overwrites them, and that's a deliberate user action. |
| Existing `data.routes` order influences lane order | Documented as the tiebreak. Users who don't care get stable defaults; users who do care have direct control. |

---

## Out of scope (deferred)

- A per-route `lane_override` field for users who want manual lane control. If the heuristic hits real misclassifications, add this in a follow-up.
- Animated transitions on auto-layout. Today the layout snaps; that's fine.
- Saving the chosen lane order to the export JSON. Lane assignment is recomputed deterministically from the data, so it round-trips correctly without explicit storage.
