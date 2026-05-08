# Warehouse-Preset Wizard — Plan A (Creation) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Add → Warehouse` with a wizard that, given Odoo-equivalent flag inputs (reception_steps, delivery_steps, manufacture_to_resupply + manufacture_steps, buy_to_resupply, resupply_wh_ids), auto-generates the supporting locations / picking types / routes / rules and merges them into the canvas with `__autoGen` provenance tags.

**Architecture:** Pure-function core (`src/warehouse-presets.js`) with sub-generators per flag, plus a single React `WizardModal` component in `odoo-inventory-flow (2).jsx`. The pure module is testable via a standalone Node test script (`src/warehouse-presets.test.mjs`) — no test framework, just `node:assert`. The wizard hooks into the existing `AddModal`'s warehouse button and writes through the existing `setData` history-aware pattern.

**Tech Stack:** React 18, esbuild bundle (no JSX/TSC tooling), Node 18+ for tests, no external deps.

**Spec:** [`docs/superpowers/specs/2026-05-08-warehouse-preset-wizard-design.md`](../specs/2026-05-08-warehouse-preset-wizard-design.md)

**Out of scope (Plans B and C):** live regeneration when editing existing warehouse fields, "Create in Odoo" mode, shrink dialog, show-inactive sidebar toggle.

---

## File structure

| File | Responsibility | Created/Modified |
|---|---|---|
| `src/warehouse-presets.js` | Pure preset generators (one per flag) + composition + provenance tagging | **Create** |
| `src/warehouse-presets.test.mjs` | Standalone Node test runner; assertions over the pure module | **Create** |
| `odoo-inventory-flow (2).jsx` | Add `WizardModal` component; modify `AddModal` to open it; add `mergeWizardOutput` helper inside `App` | **Modify** |
| `package.json` | Add `test:presets` script | **Modify** |
| `CLAUDE.md` | Mark roadmap item 1 done; document `__autoGen` provenance tag | **Modify** |

---

## Commit message convention

The repo follows Konu's commit conventions: `[TASK] - <ref> [TYPE] description`.

**Before starting**, the engineer or agent must resolve the Odoo task reference (likely something like `BRECHT-INVVIS.PS-NNN` or a follow-on to the existing main work). The placeholder `<TASK-REF>` appears in every commit step below — replace it with the real ref before running. If the ref is unclear, ask Brecht before committing.

---

### Task 0: Module scaffold + Node test runner

**Files:**
- Create: `src/warehouse-presets.js`
- Create: `src/warehouse-presets.test.mjs`
- Modify: `package.json`

- [ ] **Step 0.1: Resolve Odoo task reference**

Look up the task this work belongs to. From the previous chat, the umbrella project is `Inventory-visualiser` — search for an active task in Odoo:

```
mcp__odoo__search_records('project.task', [['name', 'ilike', 'inventory visualiser']], fields=['task_number', 'name', 'stage_id'], limit=5)
```

Pick the most recent active task. If none exists, ask Brecht to create one before any commit.

- [ ] **Step 0.2: Create the pure-module skeleton**

Create `src/warehouse-presets.js`:

```js
// Copyright (c) 2026 Dinsdag BV. All rights reserved.
// Pure-function preset generators for the warehouse-creation wizard.
// Spec: docs/superpowers/specs/2026-05-08-warehouse-preset-wizard-design.md

// presetGenerator(input) → { addNodes, addOperationTypes, addRoutes }
//
// input: {
//   warehouseId: string,                  // id of the warehouse being created/configured
//   warehouseCode: string,                // 1-5 char prefix
//   warehouseName: string,
//   flags: {
//     reception_steps: 'one_step' | 'two_steps' | 'three_steps',
//     delivery_steps:  'ship_only' | 'pick_ship' | 'pick_pack_ship',
//     manufacture_to_resupply: boolean,
//     manufacture_steps: 'mrp_one_step' | 'pbm' | 'pbm_sam',
//     buy_to_resupply: boolean,
//     resupply_wh_ids: string[]           // ids of source warehouses already on canvas
//   },
//   existingNodes: Array<{ id, type, label, data, ... }>
// }
//
// Output: { addNodes, addOperationTypes, addRoutes }.
// Every generated entity carries __autoGen = { warehouseId, source }.
// `source ∈ { 'reception_steps' | 'delivery_steps' | 'manufacture' | 'buy' | 'resupply:<wh_id>' }`.

export function presetGenerator(input) {
  // Filled in by later tasks
  return { addNodes: [], addOperationTypes: [], addRoutes: [] };
}

// Internal builders. Exported so tests can address them directly.
const _autoTag = (warehouseId, source) => ({ warehouseId, source });

const _loc = (id, label, usage, code, extra, autoGen) => ({
  id, type: 'location', label, x: 0, y: 0,
  data: {
    complete_name: label, usage, scrap_location: false,
    replenish_location: false, removal_strategy: 'fifo', barcode: code,
  },
  ...(autoGen ? { __autoGen: autoGen } : {}),
  ...extra,
});

const _ot = (id, label, code, srcId, dstId, seq, autoGen, extra = {}) => ({
  id, label, code, sequence_code: seq, src_location_id: srcId, dest_location_id: dstId,
  data: {
    name: label, code, sequence_code: seq, create_backorder: 'ask',
    reservation_method: 'at_confirm', use_create_lots: code === 'incoming',
    use_existing_lots: true, show_reserved: true,
  },
  ...(autoGen ? { __autoGen: autoGen } : {}),
  ...extra,
});

const _rule = (id, label, action, procure, srcId, dstId, otId, auto = 'manual', delay = 0, autoGen) => ({
  id, label, action, procure_method: procure,
  src_location_id: srcId, dest_location_id: dstId, picking_type_id: otId, auto,
  data: { name: label, action, procure_method: procure, auto, propagate_cancel: false, delay },
  ...(autoGen ? { __autoGen: autoGen } : {}),
});

const _route = (id, label, colorIdx, rules, flags, autoGen) => ({
  id, label, colorIdx,
  data: {
    name: label, active: true, product_selectable: false, product_categ_selectable: false,
    warehouse_selectable: true, sale_selectable: false, ...flags,
  },
  rules,
  ...(autoGen ? { __autoGen: autoGen } : {}),
});

export const _internal = { _autoTag, _loc, _ot, _rule, _route };
```

- [ ] **Step 0.3: Create the test runner**

Create `src/warehouse-presets.test.mjs`:

```js
// Standalone Node test runner. No framework — just node:assert + a tiny harness.
// Run with: npm run test:presets

import assert from 'node:assert/strict';
import { presetGenerator, _internal } from './warehouse-presets.js';

let passed = 0, failed = 0;
const runs = [];
const it = (name, fn) => runs.push({ name, fn });

const flush = async () => {
  for (const { name, fn } of runs) {
    try { await fn(); console.log(`  ok  ${name}`); passed++; }
    catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); failed++; }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
};

// ── Tests ─────────────────────────────────────────────────

it('skeleton: presetGenerator returns empty arrays by default', () => {
  const r = presetGenerator({
    warehouseId: 'wh1', warehouseCode: 'WH', warehouseName: 'Main',
    flags: {}, existingNodes: [],
  });
  assert.deepEqual(r, { addNodes: [], addOperationTypes: [], addRoutes: [] });
});

await flush();
```

- [ ] **Step 0.4: Add the npm script**

In `package.json`, modify the `scripts` block:

```json
  "scripts": {
    "build": "node scripts/build-standalone.mjs",
    "build:module": "node scripts/build-standalone.mjs",
    "proxy": "node scripts/proxy-server.mjs",
    "test:presets": "node src/warehouse-presets.test.mjs"
  },
```

- [ ] **Step 0.5: Run the smoke test**

```bash
npm run test:presets
```

Expected:
```
  ok  skeleton: presetGenerator returns empty arrays by default

1 passed, 0 failed
```

- [ ] **Step 0.6: Verify build still works**

```bash
npm run build
```

Expected: both bundles built (standalone + konu_tools), no errors. The new `src/warehouse-presets.js` is unused so far but importable.

- [ ] **Step 0.7: Commit**

```bash
git add src/warehouse-presets.js src/warehouse-presets.test.mjs package.json
git commit -m "[TASK] - <TASK-REF> [ADD] warehouse-preset module skeleton + Node test runner"
```

---

### Task 1: Reception_steps generator

**Files:**
- Modify: `src/warehouse-presets.js` (add `_genReception` + wire into `presetGenerator`)
- Modify: `src/warehouse-presets.test.mjs` (add 3 test cases)

**Semantics (mirrors Odoo `stock.warehouse._get_receive_pull_rules_dict`):**

| `reception_steps` | New locations | Op-types | Route rules |
|---|---|---|---|
| `one_step`     | (none extra) | `Receipts` | (single push of receive into Stock — no separate route, op-type alone covers it) |
| `two_steps`    | `<code>/Input` | `Receipts` (Vendors→Input), `Storage` (Input→Stock) | `Vendors→Input` (pull MTO), `Input→Stock` (pull MTS) |
| `three_steps`  | `<code>/Input`, `<code>/Quality Control` | `Receipts` (Vendors→Input), `Quality Check` (Input→QC), `Storage` (QC→Stock) | three pull rules (MTO chain, MTS at end) |

**Assumed pre-existing on canvas** (handled by Task 6 orchestrator, not by this generator): a `Vendors` (`usage=supplier`) node and a `<code>/Stock` (`usage=internal`) node belonging to the warehouse. The generator references these by id — caller must pass them in via `existingNodes` or a `ctx` object.

- [ ] **Step 1.1: Add 3 failing tests**

Append to `src/warehouse-presets.test.mjs` (above `await flush();`):

```js
// ── reception_steps ─────────────────────────────────────

const ctx = (overrides = {}) => ({
  warehouseId: 'wh1', warehouseCode: 'WH', warehouseName: 'Main',
  flags: { reception_steps: 'one_step', delivery_steps: 'ship_only',
           manufacture_to_resupply: false, manufacture_steps: 'mrp_one_step',
           buy_to_resupply: false, resupply_wh_ids: [] },
  existingNodes: [
    { id: 'loc-vendors', type: 'location', label: 'Vendors', data: { usage: 'supplier' } },
    { id: 'wh1-stock',   type: 'location', label: 'WH/Stock', data: { usage: 'internal' } },
  ],
  ...overrides,
});

it('reception_steps=one_step adds Receipts op-type, no Input/QC, no route', () => {
  const r = presetGenerator(ctx({ flags: { ...ctx().flags, reception_steps: 'one_step' } }));
  assert.equal(r.addNodes.length, 0, 'no new locations');
  assert.equal(r.addOperationTypes.length, 1, 'one op-type (Receipts)');
  assert.equal(r.addOperationTypes[0].label, 'Receipts');
  assert.equal(r.addOperationTypes[0].src_location_id, 'loc-vendors');
  assert.equal(r.addOperationTypes[0].dest_location_id, 'wh1-stock');
  assert.equal(r.addOperationTypes[0].__autoGen.source, 'reception_steps');
  assert.equal(r.addRoutes.length, 0, 'no route for 1-step (op-type alone is enough)');
});

it('reception_steps=two_steps adds Input + 2 op-types + 1 route w/ 2 rules', () => {
  const r = presetGenerator(ctx({ flags: { ...ctx().flags, reception_steps: 'two_steps' } }));
  assert.equal(r.addNodes.length, 1);
  assert.equal(r.addNodes[0].label, 'WH/Input');
  assert.equal(r.addNodes[0].data.usage, 'internal');
  assert.equal(r.addNodes[0].__autoGen.source, 'reception_steps');
  assert.equal(r.addOperationTypes.length, 2);
  assert.deepEqual(r.addOperationTypes.map(o => o.label), ['Receipts', 'Storage']);
  assert.equal(r.addRoutes.length, 1);
  assert.equal(r.addRoutes[0].rules.length, 2);
  // MTO chain ending in MTS
  assert.equal(r.addRoutes[0].rules[0].procure_method, 'make_to_order');
  assert.equal(r.addRoutes[0].rules[1].procure_method, 'make_to_stock');
});

it('reception_steps=three_steps adds Input + QC + 3 op-types + 1 route w/ 3 rules', () => {
  const r = presetGenerator(ctx({ flags: { ...ctx().flags, reception_steps: 'three_steps' } }));
  assert.equal(r.addNodes.length, 2);
  assert.deepEqual(r.addNodes.map(n => n.label).sort(), ['WH/Input', 'WH/Quality Control']);
  assert.equal(r.addOperationTypes.length, 3);
  assert.deepEqual(r.addOperationTypes.map(o => o.label), ['Receipts', 'Quality Check', 'Storage']);
  assert.equal(r.addRoutes.length, 1);
  assert.equal(r.addRoutes[0].rules.length, 3);
  assert.equal(r.addRoutes[0].rules[2].procure_method, 'make_to_stock');
});
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
npm run test:presets
```

Expected: 3 new failures (`reception_steps=...`).

- [ ] **Step 1.3: Implement `_genReception`**

In `src/warehouse-presets.js`, replace the body of `presetGenerator` and add the helper. Below the `_internal` export, add:

```js
function _findByUsage(existingNodes, usage) {
  return existingNodes.find(n => n.type === 'location' && n.data?.usage === usage);
}

function _genReception(input, ctx) {
  const { warehouseId: wid, warehouseCode: code, flags } = input;
  const stockId = ctx.stockId;
  const vendorsId = ctx.vendorsId;
  const tag = _internal._autoTag(wid, 'reception_steps');
  const colorIdx = ctx.routeColorBase + 0;

  if (flags.reception_steps === 'one_step') {
    return {
      addNodes: [],
      addOperationTypes: [
        _internal._ot(`${wid}-op-receipt`, 'Receipts', 'incoming',
          vendorsId, stockId, `${code === 'WH' ? '' : code + '-'}IN`, tag),
      ],
      addRoutes: [],
    };
  }

  const inputId = `${wid}-input`;
  const inputLoc = _internal._loc(inputId, `${code}/Input`, 'internal', `${code}-INPUT`, {}, tag);

  if (flags.reception_steps === 'two_steps') {
    const opR  = _internal._ot(`${wid}-op-receipt`, 'Receipts', 'incoming',
      vendorsId, inputId, `${code === 'WH' ? '' : code + '-'}IN`, tag);
    const opS  = _internal._ot(`${wid}-op-store`, 'Storage', 'internal',
      inputId, stockId, `${code === 'WH' ? '' : code + '-'}STO`, tag);
    return {
      addNodes: [inputLoc],
      addOperationTypes: [opR, opS],
      addRoutes: [
        _internal._route(`${wid}-route-recv`, `Receive 2 steps (Input→Stock)`, colorIdx, [
          _internal._rule(`${wid}-rl-recv-1`, 'Vendors → Input', 'pull', 'make_to_order',
            vendorsId, inputId, opR.id, 'manual', 0, tag),
          _internal._rule(`${wid}-rl-recv-2`, 'Input → Stock', 'pull', 'make_to_stock',
            inputId, stockId, opS.id, 'manual', 0, tag),
        ], { warehouse_selectable: true }, tag),
      ],
    };
  }

  // three_steps
  const qcId = `${wid}-qc`;
  const qcLoc = _internal._loc(qcId, `${code}/Quality Control`, 'internal', `${code}-QC`, {}, tag);
  const opR = _internal._ot(`${wid}-op-receipt`, 'Receipts', 'incoming',
    vendorsId, inputId, `${code === 'WH' ? '' : code + '-'}IN`, tag);
  const opQ = _internal._ot(`${wid}-op-qc`, 'Quality Check', 'internal',
    inputId, qcId, `${code === 'WH' ? '' : code + '-'}QC`, tag);
  const opS = _internal._ot(`${wid}-op-store`, 'Storage', 'internal',
    qcId, stockId, `${code === 'WH' ? '' : code + '-'}STO`, tag);
  return {
    addNodes: [inputLoc, qcLoc],
    addOperationTypes: [opR, opQ, opS],
    addRoutes: [
      _internal._route(`${wid}-route-recv`, `Receive 3 steps (Input→QC→Stock)`, colorIdx, [
        _internal._rule(`${wid}-rl-recv-1`, 'Vendors → Input', 'pull', 'make_to_order',
          vendorsId, inputId, opR.id, 'manual', 0, tag),
        _internal._rule(`${wid}-rl-recv-2`, 'Input → QC', 'pull', 'make_to_order',
          inputId, qcId, opQ.id, 'manual', 0, tag),
        _internal._rule(`${wid}-rl-recv-3`, 'QC → Stock', 'pull', 'make_to_stock',
          qcId, stockId, opS.id, 'manual', 0, tag),
      ], { warehouse_selectable: true }, tag),
    ],
  };
}
```

Then replace `presetGenerator` with a stub that wires reception only:

```js
export function presetGenerator(input) {
  const out = { addNodes: [], addOperationTypes: [], addRoutes: [] };
  // Resolve common ids: vendors (existing or to-be-created), stock (assumed to exist with id `<wid>-stock`)
  const vendorsExisting = _findByUsage(input.existingNodes, 'supplier');
  const stockExisting = input.existingNodes.find(n =>
    n.type === 'location' && n.data?.usage === 'internal' &&
    n.id === `${input.warehouseId}-stock`);
  const ctx = {
    vendorsId: vendorsExisting?.id ?? 'loc-vendors',
    stockId: stockExisting?.id ?? `${input.warehouseId}-stock`,
    routeColorBase: 0, // refined later
  };
  const r = _genReception(input, ctx);
  out.addNodes.push(...r.addNodes);
  out.addOperationTypes.push(...r.addOperationTypes);
  out.addRoutes.push(...r.addRoutes);
  return out;
}
```

- [ ] **Step 1.4: Run tests to confirm pass**

```bash
npm run test:presets
```

Expected: 4 passed (the skeleton test + 3 reception tests). 0 failed.

- [ ] **Step 1.5: Commit**

```bash
git add src/warehouse-presets.js src/warehouse-presets.test.mjs
git commit -m "[TASK] - <TASK-REF> [ADD] reception_steps preset generator (1/2/3 steps)"
```

---

### Task 2: Delivery_steps generator

**Files:**
- Modify: `src/warehouse-presets.js`
- Modify: `src/warehouse-presets.test.mjs`

Symmetric to Task 1. Mapping:

| `delivery_steps` | New locations | Op-types | Route rules |
|---|---|---|---|
| `ship_only`      | (none) | `Delivery Orders` (Stock→Customers) | (no separate route) |
| `pick_ship`      | `<code>/Output` | `Pick` (Stock→Output), `Delivery Orders` (Output→Customers) | 2 pull MTO rules |
| `pick_pack_ship` | `<code>/Packing`, `<code>/Output` | `Pick` (Stock→Pack), `Pack` (Pack→Output), `Delivery Orders` (Output→Customers) | 3 pull MTO rules |

Assumes Customers (`usage=customer`) on canvas — Task 6 orchestrator handles its creation if missing.

- [ ] **Step 2.1: Add tests**

Append to `src/warehouse-presets.test.mjs` (above `await flush();`):

```js
// ── delivery_steps ─────────────────────────────────────

const ctxD = (delivery_steps) => ctx({
  flags: { ...ctx().flags, reception_steps: 'one_step', delivery_steps },
  existingNodes: [
    { id: 'loc-vendors',   type: 'location', label: 'Vendors',   data: { usage: 'supplier' } },
    { id: 'loc-customers', type: 'location', label: 'Customers', data: { usage: 'customer' } },
    { id: 'wh1-stock',     type: 'location', label: 'WH/Stock',  data: { usage: 'internal' } },
  ],
});

it('delivery_steps=ship_only adds Delivery Orders op-type, no extra location', () => {
  const r = presetGenerator(ctxD('ship_only'));
  // (Reception=one_step also adds 1 op-type, so total ops = 2)
  const dlv = r.addOperationTypes.find(o => o.label === 'Delivery Orders');
  assert.ok(dlv);
  assert.equal(dlv.src_location_id, 'wh1-stock');
  assert.equal(dlv.dest_location_id, 'loc-customers');
  assert.equal(dlv.__autoGen.source, 'delivery_steps');
  assert.equal(r.addNodes.filter(n => n.__autoGen?.source === 'delivery_steps').length, 0);
  assert.equal(r.addRoutes.filter(rt => rt.__autoGen?.source === 'delivery_steps').length, 0);
});

it('delivery_steps=pick_ship adds Output + Pick + Delivery + 1 route w/ 2 rules', () => {
  const r = presetGenerator(ctxD('pick_ship'));
  const newLocs = r.addNodes.filter(n => n.__autoGen?.source === 'delivery_steps');
  assert.equal(newLocs.length, 1);
  assert.equal(newLocs[0].label, 'WH/Output');
  const newOps = r.addOperationTypes.filter(o => o.__autoGen?.source === 'delivery_steps');
  assert.deepEqual(newOps.map(o => o.label), ['Pick', 'Delivery Orders']);
  const newRoutes = r.addRoutes.filter(rt => rt.__autoGen?.source === 'delivery_steps');
  assert.equal(newRoutes.length, 1);
  assert.equal(newRoutes[0].rules.length, 2);
});

it('delivery_steps=pick_pack_ship adds Pack + Output + 3 ops + 1 route w/ 3 rules', () => {
  const r = presetGenerator(ctxD('pick_pack_ship'));
  const newLocs = r.addNodes.filter(n => n.__autoGen?.source === 'delivery_steps');
  assert.deepEqual(newLocs.map(n => n.label).sort(), ['WH/Output', 'WH/Packing']);
  const newOps = r.addOperationTypes.filter(o => o.__autoGen?.source === 'delivery_steps');
  assert.deepEqual(newOps.map(o => o.label), ['Pick', 'Pack', 'Delivery Orders']);
  const newRoutes = r.addRoutes.filter(rt => rt.__autoGen?.source === 'delivery_steps');
  assert.equal(newRoutes.length, 1);
  assert.equal(newRoutes[0].rules.length, 3);
});
```

- [ ] **Step 2.2: Run tests, observe failures**

```bash
npm run test:presets
```

Expected: 3 new failures.

- [ ] **Step 2.3: Implement `_genDelivery`**

In `src/warehouse-presets.js`, after `_genReception`, add:

```js
function _genDelivery(input, ctx) {
  const { warehouseId: wid, warehouseCode: code, flags } = input;
  const stockId = ctx.stockId;
  const customersId = ctx.customersId;
  const tag = _internal._autoTag(wid, 'delivery_steps');
  const colorIdx = ctx.routeColorBase + 1;
  const seq = (suffix) => `${code === 'WH' ? '' : code + '-'}${suffix}`;

  if (flags.delivery_steps === 'ship_only') {
    return {
      addNodes: [],
      addOperationTypes: [
        _internal._ot(`${wid}-op-deliv`, 'Delivery Orders', 'outgoing',
          stockId, customersId, seq('OUT'), tag),
      ],
      addRoutes: [],
    };
  }

  const outputId = `${wid}-output`;
  const outputLoc = _internal._loc(outputId, `${code}/Output`, 'internal', `${code}-OUTPUT`, {}, tag);

  if (flags.delivery_steps === 'pick_ship') {
    const opP = _internal._ot(`${wid}-op-pick`, 'Pick', 'internal',
      stockId, outputId, seq('PICK'), tag);
    const opD = _internal._ot(`${wid}-op-deliv`, 'Delivery Orders', 'outgoing',
      outputId, customersId, seq('OUT'), tag);
    return {
      addNodes: [outputLoc],
      addOperationTypes: [opP, opD],
      addRoutes: [
        _internal._route(`${wid}-route-deliv`, `Pick → Ship`, colorIdx, [
          _internal._rule(`${wid}-rl-deliv-1`, 'Stock → Output', 'pull', 'make_to_order',
            stockId, outputId, opP.id, 'manual', 0, tag),
          _internal._rule(`${wid}-rl-deliv-2`, 'Output → Customers', 'pull', 'make_to_order',
            outputId, customersId, opD.id, 'manual', 0, tag),
        ], { warehouse_selectable: true, sale_selectable: true }, tag),
      ],
    };
  }

  // pick_pack_ship
  const packId = `${wid}-pack`;
  const packLoc = _internal._loc(packId, `${code}/Packing`, 'internal', `${code}-PACK`, {}, tag);
  const opP  = _internal._ot(`${wid}-op-pick`, 'Pick', 'internal',
    stockId, packId, seq('PICK'), tag);
  const opPk = _internal._ot(`${wid}-op-pack`, 'Pack', 'internal',
    packId, outputId, seq('PACK'), tag);
  const opD  = _internal._ot(`${wid}-op-deliv`, 'Delivery Orders', 'outgoing',
    outputId, customersId, seq('OUT'), tag);
  return {
    addNodes: [packLoc, outputLoc],
    addOperationTypes: [opP, opPk, opD],
    addRoutes: [
      _internal._route(`${wid}-route-deliv`, `Pick → Pack → Ship`, colorIdx, [
        _internal._rule(`${wid}-rl-deliv-1`, 'Stock → Packing', 'pull', 'make_to_order',
          stockId, packId, opP.id, 'manual', 0, tag),
        _internal._rule(`${wid}-rl-deliv-2`, 'Packing → Output', 'pull', 'make_to_order',
          packId, outputId, opPk.id, 'manual', 0, tag),
        _internal._rule(`${wid}-rl-deliv-3`, 'Output → Customers', 'pull', 'make_to_order',
          outputId, customersId, opD.id, 'manual', 0, tag),
      ], { warehouse_selectable: true, sale_selectable: true }, tag),
    ],
  };
}
```

Then update `presetGenerator` to call it. Replace the body with:

```js
export function presetGenerator(input) {
  const out = { addNodes: [], addOperationTypes: [], addRoutes: [] };
  const vendorsExisting = _findByUsage(input.existingNodes, 'supplier');
  const customersExisting = _findByUsage(input.existingNodes, 'customer');
  const stockExisting = input.existingNodes.find(n =>
    n.type === 'location' && n.data?.usage === 'internal' &&
    n.id === `${input.warehouseId}-stock`);
  const ctx = {
    vendorsId:   vendorsExisting?.id   ?? 'loc-vendors',
    customersId: customersExisting?.id ?? 'loc-customers',
    stockId:     stockExisting?.id     ?? `${input.warehouseId}-stock`,
    routeColorBase: 0,
  };
  for (const fn of [_genReception, _genDelivery]) {
    const r = fn(input, ctx);
    out.addNodes.push(...r.addNodes);
    out.addOperationTypes.push(...r.addOperationTypes);
    out.addRoutes.push(...r.addRoutes);
  }
  return out;
}
```

- [ ] **Step 2.4: Run tests**

```bash
npm run test:presets
```

Expected: 7 passed, 0 failed.

- [ ] **Step 2.5: Commit**

```bash
git add src/warehouse-presets.js src/warehouse-presets.test.mjs
git commit -m "[TASK] - <TASK-REF> [ADD] delivery_steps preset generator (1/2/3 steps)"
```

---

### Task 3: Manufacture generator (with manufacture_steps sub-options)

**Files:**
- Modify: `src/warehouse-presets.js`
- Modify: `src/warehouse-presets.test.mjs`

**Semantics:**

| `manufacture_steps` | New locations | Op-types | Route |
|---|---|---|---|
| `mrp_one_step` | `<code>/Production` (`usage=production`) | `Manufacturing` (Stock→Production virtual)  + `Production output` (Production→Stock, push) | 2-rule route |
| `pbm`         | `<code>/Pre-Production` (internal), `<code>/Production` (production) | `MO Picking` (Stock→PreProd), `Manufacturing` (PreProd→Production), `Post-Production` (Production→Stock, push) | 3-rule route |
| `pbm_sam`     | `<code>/Pre-Production`, `<code>/Production` (no separate post-prod location; Odoo reuses Stock as the destination) | Same 3 op-types | 3-rule route w/ `propagate_cancel=true` and `auto=transparent` on the push |

Skipped entirely if `manufacture_to_resupply === false`.

- [ ] **Step 3.1: Add 4 tests** (one off, three on)

Append:

```js
// ── manufacture ─────────────────────────────────────

it('manufacture_to_resupply=false produces no manufacture entities', () => {
  const r = presetGenerator(ctx({ flags: { ...ctx().flags, manufacture_to_resupply: false } }));
  assert.equal(r.addNodes.filter(n => n.__autoGen?.source === 'manufacture').length, 0);
  assert.equal(r.addOperationTypes.filter(o => o.__autoGen?.source === 'manufacture').length, 0);
  assert.equal(r.addRoutes.filter(rt => rt.__autoGen?.source === 'manufacture').length, 0);
});

it('manufacture mrp_one_step adds Production + 2 op-types + 1 route w/ 2 rules', () => {
  const r = presetGenerator(ctx({ flags: { ...ctx().flags,
    manufacture_to_resupply: true, manufacture_steps: 'mrp_one_step' } }));
  const ml = r.addNodes.filter(n => n.__autoGen?.source === 'manufacture');
  assert.deepEqual(ml.map(n => n.data.usage).sort(), ['production']);
  const mo = r.addOperationTypes.filter(o => o.__autoGen?.source === 'manufacture');
  assert.deepEqual(mo.map(o => o.label), ['Manufacturing', 'Production output']);
  const mr = r.addRoutes.filter(rt => rt.__autoGen?.source === 'manufacture');
  assert.equal(mr.length, 1);
  assert.equal(mr[0].rules.length, 2);
  assert.equal(mr[0].rules[0].action, 'manufacture');
  assert.equal(mr[0].rules[1].action, 'push');
});

it('manufacture pbm adds Pre-Prod + Production + 3 op-types + 1 route w/ 3 rules', () => {
  const r = presetGenerator(ctx({ flags: { ...ctx().flags,
    manufacture_to_resupply: true, manufacture_steps: 'pbm' } }));
  const ml = r.addNodes.filter(n => n.__autoGen?.source === 'manufacture');
  assert.deepEqual(ml.map(n => n.data.usage).sort(), ['internal', 'production']);
  const mr = r.addRoutes.filter(rt => rt.__autoGen?.source === 'manufacture');
  assert.equal(mr[0].rules.length, 3);
  assert.deepEqual(mr[0].rules.map(r => r.action), ['pull', 'manufacture', 'push']);
});

it('manufacture pbm_sam: Post-Production rule is auto=transparent push', () => {
  const r = presetGenerator(ctx({ flags: { ...ctx().flags,
    manufacture_to_resupply: true, manufacture_steps: 'pbm_sam' } }));
  const mr = r.addRoutes.find(rt => rt.__autoGen?.source === 'manufacture');
  const last = mr.rules[mr.rules.length - 1];
  assert.equal(last.action, 'push');
  assert.equal(last.auto, 'transparent');
});
```

- [ ] **Step 3.2: Run, observe failures**

```bash
npm run test:presets
```

- [ ] **Step 3.3: Implement `_genManufacture`**

After `_genDelivery`, add:

```js
function _genManufacture(input, ctx) {
  const { warehouseId: wid, warehouseCode: code, flags } = input;
  if (!flags.manufacture_to_resupply) return { addNodes: [], addOperationTypes: [], addRoutes: [] };
  const tag = _internal._autoTag(wid, 'manufacture');
  const colorIdx = ctx.routeColorBase + 2;
  const stockId = ctx.stockId;
  const seq = (suffix) => `${code === 'WH' ? '' : code + '-'}${suffix}`;

  const prodId = `${wid}-production`;
  const prodLoc = _internal._loc(prodId, `${code}/Production`, 'production', '', {}, tag);

  if (flags.manufacture_steps === 'mrp_one_step') {
    const opM = _internal._ot(`${wid}-op-mfg`, 'Manufacturing', 'mrp_operation',
      stockId, prodId, seq('MO'), tag);
    const opS = _internal._ot(`${wid}-op-mfg-store`, 'Production output', 'internal',
      prodId, stockId, seq('SFP'), tag);
    return {
      addNodes: [prodLoc],
      addOperationTypes: [opM, opS],
      addRoutes: [
        _internal._route(`${wid}-route-mfg`, `Manufacture`, colorIdx, [
          _internal._rule(`${wid}-rl-mfg-1`, 'Stock → Production', 'manufacture', 'make_to_order',
            stockId, prodId, opM.id, 'manual', 1, tag),
          _internal._rule(`${wid}-rl-mfg-2`, 'Production → Stock', 'push', 'make_to_stock',
            prodId, stockId, opS.id, 'manual', 0, tag),
        ], { product_selectable: true, product_categ_selectable: true }, tag),
      ],
    };
  }

  // pbm or pbm_sam — both produce Pre-Prod + Production
  const preId = `${wid}-preprod`;
  const preLoc = _internal._loc(preId, `${code}/Pre-Production`, 'internal', `${code}-PREPROD`, {}, tag);
  const opPick = _internal._ot(`${wid}-op-mo-pick`, 'MO Picking', 'internal',
    stockId, preId, seq('PC'), tag);
  const opM = _internal._ot(`${wid}-op-mfg`, 'Manufacturing', 'mrp_operation',
    preId, prodId, seq('MO'), tag);
  const opS = _internal._ot(`${wid}-op-mfg-store`, 'Post-Production', 'internal',
    prodId, stockId, seq('SFP'), tag);

  const isSam = flags.manufacture_steps === 'pbm_sam';
  const pushAuto = isSam ? 'transparent' : 'manual';

  return {
    addNodes: [preLoc, prodLoc],
    addOperationTypes: [opPick, opM, opS],
    addRoutes: [
      _internal._route(`${wid}-route-mfg`, `Manufacture`, colorIdx, [
        _internal._rule(`${wid}-rl-mfg-1`, 'Stock → Pre-Prod', 'pull', 'make_to_order',
          stockId, preId, opPick.id, 'manual', 0, tag),
        _internal._rule(`${wid}-rl-mfg-2`, 'Pre-Prod → Production', 'manufacture', 'make_to_order',
          preId, prodId, opM.id, 'manual', 1, tag),
        _internal._rule(`${wid}-rl-mfg-3`, 'Production → Stock', 'push', 'make_to_stock',
          prodId, stockId, opS.id, pushAuto, 0, tag),
      ], { product_selectable: true, product_categ_selectable: true }, tag),
    ],
  };
}
```

Update `presetGenerator`'s loop:

```js
  for (const fn of [_genReception, _genDelivery, _genManufacture]) {
```

- [ ] **Step 3.4: Run tests**

```bash
npm run test:presets
```

Expected: 11 passed, 0 failed.

- [ ] **Step 3.5: Commit**

```bash
git add src/warehouse-presets.js src/warehouse-presets.test.mjs
git commit -m "[TASK] - <TASK-REF> [ADD] manufacture preset generator (mrp_one_step / pbm / pbm_sam)"
```

---

### Task 4: Buy generator

**Files:**
- Modify: `src/warehouse-presets.js`
- Modify: `src/warehouse-presets.test.mjs`

**Semantics:** `buy_to_resupply=true` adds a single 1-rule route with `action='buy'` going `Vendors → <first inbound location>`. The inbound destination depends on reception_steps:
- `one_step` → Stock
- `two_steps` / `three_steps` → Input

`buy_to_resupply=false` produces nothing.

No new locations or op-types — the buy route reuses the receipts op-type.

- [ ] **Step 4.1: Add tests**

Append:

```js
// ── buy ─────────────────────────────────────

it('buy_to_resupply=false produces no buy entities', () => {
  const r = presetGenerator(ctx({ flags: { ...ctx().flags, buy_to_resupply: false } }));
  assert.equal(r.addRoutes.filter(rt => rt.__autoGen?.source === 'buy').length, 0);
});

it('buy with reception_steps=one_step → Vendors → Stock buy rule', () => {
  const r = presetGenerator(ctx({ flags: { ...ctx().flags,
    buy_to_resupply: true, reception_steps: 'one_step' } }));
  const buy = r.addRoutes.find(rt => rt.__autoGen?.source === 'buy');
  assert.ok(buy);
  assert.equal(buy.rules.length, 1);
  assert.equal(buy.rules[0].action, 'buy');
  assert.equal(buy.rules[0].src_location_id, 'loc-vendors');
  assert.equal(buy.rules[0].dest_location_id, 'wh1-stock');
});

it('buy with reception_steps=three_steps → Vendors → Input buy rule', () => {
  const r = presetGenerator(ctx({ flags: { ...ctx().flags,
    buy_to_resupply: true, reception_steps: 'three_steps' } }));
  const buy = r.addRoutes.find(rt => rt.__autoGen?.source === 'buy');
  assert.equal(buy.rules[0].dest_location_id, 'wh1-input');
});
```

- [ ] **Step 4.2: Run, observe failures**

```bash
npm run test:presets
```

- [ ] **Step 4.3: Implement `_genBuy`**

After `_genManufacture`, add:

```js
function _genBuy(input, ctx) {
  const { warehouseId: wid, flags } = input;
  if (!flags.buy_to_resupply) return { addNodes: [], addOperationTypes: [], addRoutes: [] };
  const tag = _internal._autoTag(wid, 'buy');
  const colorIdx = ctx.routeColorBase + 4;
  const dstId = flags.reception_steps === 'one_step' ? ctx.stockId : `${wid}-input`;
  const opReceiptId = `${wid}-op-receipt`;
  return {
    addNodes: [],
    addOperationTypes: [],
    addRoutes: [
      _internal._route(`${wid}-route-buy`, `Buy`, colorIdx, [
        _internal._rule(`${wid}-rl-buy`, 'Buy', 'buy', 'make_to_order',
          ctx.vendorsId, dstId, opReceiptId, 'manual', 3, tag),
      ], { warehouse_selectable: true }, tag),
    ],
  };
}
```

Update `presetGenerator`'s loop:

```js
  for (const fn of [_genReception, _genDelivery, _genManufacture, _genBuy]) {
```

- [ ] **Step 4.4: Run tests**

```bash
npm run test:presets
```

Expected: 14 passed.

- [ ] **Step 4.5: Commit**

```bash
git add src/warehouse-presets.js src/warehouse-presets.test.mjs
git commit -m "[TASK] - <TASK-REF> [ADD] buy preset generator"
```

---

### Task 5: Resupply generator (two-sided tagging)

**Files:**
- Modify: `src/warehouse-presets.js`
- Modify: `src/warehouse-presets.test.mjs`

**Semantics:** for each source warehouse id in `flags.resupply_wh_ids`, generate:
- One Transit location (`usage=transit`), `warehouseId=<target>`, `source='resupply:<source>'`.
- One IN op-type on target side: `Receipts from <source>`. Tagged `warehouseId=<target>`, `source='resupply:<source>'`.
- One OUT op-type on source side: `Send to <target>`. Tagged `warehouseId=<source>`, `source='resupply:<target>'`.
- One route on target side: 2 rules (source.Stock → Transit, Transit → target.Stock). Tagged `warehouseId=<target>`, `source='resupply:<source>'`.

The two-sided tagging is the load-bearing detail — see spec §"Sequencing inside presetGenerator".

The source warehouse's stock id is assumed to be `<source_wh_id>-stock`. If not on canvas (i.e. the user named it differently), look it up via `existingNodes` filter on `__autoGen.warehouseId === source_wh_id` and `data.usage === 'internal'` and label includes 'Stock'. Fall back to `<source>-stock` if unfound.

- [ ] **Step 5.1: Add tests**

Append:

```js
// ── resupply ─────────────────────────────────────

const ctxR = (resupply_wh_ids) => ctx({
  flags: { ...ctx().flags, resupply_wh_ids },
  warehouseId: 'wh2', warehouseCode: 'WH2', warehouseName: 'Secondary',
  existingNodes: [
    { id: 'loc-vendors',   type: 'location', label: 'Vendors',    data: { usage: 'supplier' } },
    { id: 'loc-customers', type: 'location', label: 'Customers',  data: { usage: 'customer' } },
    { id: 'wh1-stock',     type: 'location', label: 'WH/Stock',   data: { usage: 'internal' },
      __autoGen: { warehouseId: 'wh1', source: 'reception_steps' } },
    { id: 'wh2-stock',     type: 'location', label: 'WH2/Stock',  data: { usage: 'internal' },
      __autoGen: { warehouseId: 'wh2', source: 'reception_steps' } },
  ],
});

it('resupply: empty resupply_wh_ids produces nothing', () => {
  const r = presetGenerator(ctxR([]));
  assert.equal(r.addNodes.filter(n => n.__autoGen?.source?.startsWith('resupply:')).length, 0);
});

it('resupply: target wh2 from source wh1 — Transit on target side', () => {
  const r = presetGenerator(ctxR(['wh1']));
  const transit = r.addNodes.find(n => n.data.usage === 'transit');
  assert.ok(transit);
  assert.equal(transit.__autoGen.warehouseId, 'wh2');
  assert.equal(transit.__autoGen.source, 'resupply:wh1');
});

it('resupply: target wh2 from source wh1 — IN op-type on target side', () => {
  const r = presetGenerator(ctxR(['wh1']));
  const inOp = r.addOperationTypes.find(o => o.label === 'Receipts from WH');
  assert.ok(inOp);
  assert.equal(inOp.__autoGen.warehouseId, 'wh2');
  assert.equal(inOp.__autoGen.source, 'resupply:wh1');
});

it('resupply: OUT op-type tagged to source warehouse + source key resupply:<target>', () => {
  const r = presetGenerator(ctxR(['wh1']));
  const outOp = r.addOperationTypes.find(o => o.label === 'Send to WH2');
  assert.ok(outOp);
  assert.equal(outOp.__autoGen.warehouseId, 'wh1', 'OUT op-type belongs to source warehouse');
  assert.equal(outOp.__autoGen.source, 'resupply:wh2', 'source key uses target warehouse id');
});

it('resupply: route has 2 rules, target-side, tagged resupply:<source>', () => {
  const r = presetGenerator(ctxR(['wh1']));
  const route = r.addRoutes.find(rt => rt.__autoGen?.source === 'resupply:wh1');
  assert.ok(route);
  assert.equal(route.__autoGen.warehouseId, 'wh2');
  assert.equal(route.rules.length, 2);
  // Rule 1: source.Stock → Transit
  assert.equal(route.rules[0].src_location_id, 'wh1-stock');
  assert.equal(route.rules[0].dest_location_id, route.rules[1].src_location_id, 'rule 2 src = rule 1 dst (Transit)');
  // Rule 2: Transit → target.Stock
  assert.equal(route.rules[1].dest_location_id, 'wh2-stock');
});
```

- [ ] **Step 5.2: Run, observe failures**

```bash
npm run test:presets
```

- [ ] **Step 5.3: Implement `_genResupply`**

After `_genBuy`, add:

```js
function _resolveSourceStockId(existingNodes, sourceWid) {
  // Prefer canonical id pattern; fall back to lookup by tag.
  const fromTag = existingNodes.find(n =>
    n.type === 'location' &&
    n.data?.usage === 'internal' &&
    n.__autoGen?.warehouseId === sourceWid &&
    /\bStock\b/.test(n.label || ''));
  if (fromTag) return fromTag.id;
  return `${sourceWid}-stock`;
}

function _resolveSourceCode(existingNodes, sourceWid) {
  const wh = existingNodes.find(n => n.type === 'warehouse' && n.id === sourceWid);
  return wh?.data?.code || 'WH';
}

function _genResupply(input, ctx) {
  const { warehouseId: targetWid, warehouseCode: targetCode, flags, existingNodes } = input;
  const out = { addNodes: [], addOperationTypes: [], addRoutes: [] };
  const seq = (suffix) => `${targetCode === 'WH' ? '' : targetCode + '-'}${suffix}`;

  flags.resupply_wh_ids.forEach((sourceWid, idx) => {
    const sourceCode = _resolveSourceCode(existingNodes, sourceWid);
    const sourceStockId = _resolveSourceStockId(existingNodes, sourceWid);
    const targetTag = _internal._autoTag(targetWid, `resupply:${sourceWid}`);
    const sourceTag = _internal._autoTag(sourceWid, `resupply:${targetWid}`);

    const transitId = `${targetWid}-transit-${sourceWid}`;
    const transitLoc = _internal._loc(transitId, `${targetCode}/Transit (from ${sourceCode})`,
      'transit', `${targetCode}-TRANSIT-${sourceCode}`, {}, targetTag);

    const inOp = _internal._ot(`${targetWid}-op-in-${sourceWid}`, `Receipts from ${sourceCode}`,
      'incoming', transitId, ctx.stockId, seq(`IN-${sourceCode}`), targetTag);

    const outOp = _internal._ot(`${sourceWid}-op-out-${targetWid}`, `Send to ${targetCode}`,
      'outgoing', sourceStockId, transitId,
      `${sourceCode === 'WH' ? '' : sourceCode + '-'}OUT-${targetCode}`, sourceTag);

    const route = _internal._route(
      `${targetWid}-route-resupply-${sourceWid}`,
      `Resupply from ${sourceCode}`,
      ctx.routeColorBase + 5 + idx,
      [
        _internal._rule(
          `${targetWid}-rl-resupply-${sourceWid}-1`,
          `${sourceCode}/Stock → Transit`, 'pull', 'make_to_order',
          sourceStockId, transitId, outOp.id, 'manual', 0, targetTag,
        ),
        _internal._rule(
          `${targetWid}-rl-resupply-${sourceWid}-2`,
          `Transit → ${targetCode}/Stock`, 'pull', 'make_to_order',
          transitId, ctx.stockId, inOp.id, 'manual', 0, targetTag,
        ),
      ],
      { warehouse_selectable: true },
      targetTag,
    );

    out.addNodes.push(transitLoc);
    out.addOperationTypes.push(inOp, outOp);
    out.addRoutes.push(route);
  });
  return out;
}
```

Update `presetGenerator`'s loop:

```js
  for (const fn of [_genReception, _genDelivery, _genManufacture, _genBuy, _genResupply]) {
```

- [ ] **Step 5.4: Run tests**

```bash
npm run test:presets
```

Expected: 19 passed, 0 failed.

- [ ] **Step 5.5: Commit**

```bash
git add src/warehouse-presets.js src/warehouse-presets.test.mjs
git commit -m "[TASK] - <TASK-REF> [ADD] resupply preset generator with two-sided provenance tagging"
```

---

### Task 6: Top-level orchestrator — Stock + Vendors + Customers + warehouse node

**Files:**
- Modify: `src/warehouse-presets.js`
- Modify: `src/warehouse-presets.test.mjs`

The sub-generators all assume `Stock`, `Vendors`, `Customers`, and the `Warehouse` node already exist (or have known ids). The orchestrator's job: emit those if missing.

**Rules:**
- Always emit a Warehouse node (`type=warehouse`) with the input's `code`, `name`, and the input flags as its `data`. Tagged `__autoGen={warehouseId,source:'identity'}`.
- Always emit a `<wid>-stock` location (`usage=internal`) tagged `source: 'identity'`.
- Vendors: emit only if not already in `existingNodes`. Tagged `source: 'identity'` if newly created. Reused otherwise.
- Customers: same.

Why `source: 'identity'`? It separates the "this warehouse exists" entities from the flag-driven cascades. They are owned by this warehouse but are never removed by shrinking a flag — only by deleting the warehouse itself.

- [ ] **Step 6.1: Add tests**

Append:

```js
// ── orchestrator (Stock + Vendors + Customers + Warehouse) ─────────────

it('orchestrator: empty canvas + new warehouse → emits Warehouse + Stock + Vendors + Customers', () => {
  const r = presetGenerator({
    warehouseId: 'wh1', warehouseCode: 'WH', warehouseName: 'Main',
    flags: { reception_steps: 'one_step', delivery_steps: 'ship_only',
             manufacture_to_resupply: false, manufacture_steps: 'mrp_one_step',
             buy_to_resupply: false, resupply_wh_ids: [] },
    existingNodes: [],
  });
  const labels = r.addNodes.map(n => n.label).sort();
  assert.deepEqual(labels, ['Customers', 'Main', 'Vendors', 'WH/Stock']);
  // Identity-tagged
  for (const n of r.addNodes) {
    assert.ok(n.__autoGen, `${n.label} should have __autoGen`);
    if (['Vendors', 'Customers', 'WH/Stock', 'Main'].includes(n.label)) {
      assert.equal(n.__autoGen.source, 'identity', `${n.label} → identity`);
    }
  }
});

it('orchestrator: existing Vendors on canvas → reused, not duplicated', () => {
  const r = presetGenerator({
    warehouseId: 'wh2', warehouseCode: 'WH2', warehouseName: 'Secondary',
    flags: { reception_steps: 'one_step', delivery_steps: 'ship_only',
             manufacture_to_resupply: false, manufacture_steps: 'mrp_one_step',
             buy_to_resupply: false, resupply_wh_ids: [] },
    existingNodes: [
      { id: 'loc-vendors',   type: 'location', label: 'Vendors',   data: { usage: 'supplier' } },
      { id: 'loc-customers', type: 'location', label: 'Customers', data: { usage: 'customer' } },
    ],
  });
  // No new Vendors / Customers
  assert.equal(r.addNodes.filter(n => n.label === 'Vendors').length, 0);
  assert.equal(r.addNodes.filter(n => n.label === 'Customers').length, 0);
  // Op-types reference the existing supplier/customer ids
  const opR = r.addOperationTypes.find(o => o.label === 'Receipts');
  assert.equal(opR.src_location_id, 'loc-vendors');
});

it('orchestrator: warehouse node carries the flags as its data', () => {
  const r = presetGenerator({
    warehouseId: 'wh1', warehouseCode: 'WH', warehouseName: 'Main',
    flags: { reception_steps: 'three_steps', delivery_steps: 'pick_pack_ship',
             manufacture_to_resupply: true, manufacture_steps: 'pbm_sam',
             buy_to_resupply: true, resupply_wh_ids: [] },
    existingNodes: [],
  });
  const wh = r.addNodes.find(n => n.type === 'warehouse');
  assert.ok(wh);
  assert.equal(wh.id, 'wh1');
  assert.equal(wh.data.code, 'WH');
  assert.equal(wh.data.name, 'Main');
  assert.equal(wh.data.reception_steps, 'three_steps');
  assert.equal(wh.data.manufacture_steps, 'pbm_sam');
  assert.equal(wh.data.buy_to_resupply, true);
});
```

- [ ] **Step 6.2: Run, observe failures**

The first new test should fail because the orchestrator currently emits no identity entities; the second should pass partially (no Vendors duplicate because we don't emit any) but Receipts won't reference 'loc-vendors' if reception_steps is 'one_step' — let's actually verify; the third will fail (no warehouse node).

```bash
npm run test:presets
```

- [ ] **Step 6.3: Replace `presetGenerator` with the orchestrator**

In `src/warehouse-presets.js`, replace `presetGenerator` with:

```js
export function presetGenerator(input) {
  const out = { addNodes: [], addOperationTypes: [], addRoutes: [] };
  const idTag = _internal._autoTag(input.warehouseId, 'identity');

  // Warehouse node
  out.addNodes.push({
    id: input.warehouseId, type: 'warehouse', label: input.warehouseName, x: 0, y: 0,
    data: { code: input.warehouseCode, name: input.warehouseName, ...input.flags, active: true },
    __autoGen: idTag,
  });

  // Stock (always per-warehouse)
  const stockId = `${input.warehouseId}-stock`;
  out.addNodes.push(_internal._loc(
    stockId, `${input.warehouseCode}/Stock`, 'internal',
    `${input.warehouseCode}-STOCK`, {}, idTag,
  ));

  // Vendors / Customers — emit only if missing on canvas
  const vendorsExisting = _findByUsage(input.existingNodes, 'supplier');
  const customersExisting = _findByUsage(input.existingNodes, 'customer');
  let vendorsId = vendorsExisting?.id;
  let customersId = customersExisting?.id;
  if (!vendorsExisting) {
    vendorsId = 'loc-vendors';
    out.addNodes.push(_internal._loc(vendorsId, 'Vendors', 'supplier', '', {}, idTag));
  }
  if (!customersExisting) {
    customersId = 'loc-customers';
    out.addNodes.push(_internal._loc(customersId, 'Customers', 'customer', '', {}, idTag));
  }

  const ctx = { vendorsId, customersId, stockId, routeColorBase: 0, existingNodes: input.existingNodes };
  for (const fn of [_genReception, _genDelivery, _genManufacture, _genBuy, _genResupply]) {
    const r = fn(input, ctx);
    out.addNodes.push(...r.addNodes);
    out.addOperationTypes.push(...r.addOperationTypes);
    out.addRoutes.push(...r.addRoutes);
  }
  return out;
}
```

- [ ] **Step 6.4: Adjust earlier tests that now break**

Earlier tests passed `existingNodes: [{...stock}]` with id `wh1-stock`. The orchestrator now also emits its own `wh1-stock` — that creates a duplicate. The orchestrator's logic should detect the existing stock and skip. Add a guard in `presetGenerator`:

```js
  // Stock (always per-warehouse, but skip if already on canvas)
  const stockId = `${input.warehouseId}-stock`;
  const stockExisting = input.existingNodes.find(n =>
    n.type === 'location' && n.id === stockId);
  if (!stockExisting) {
    out.addNodes.push(_internal._loc(
      stockId, `${input.warehouseCode}/Stock`, 'internal',
      `${input.warehouseCode}-STOCK`, {}, idTag,
    ));
  }
```

Apply the same logic for the warehouse node:

```js
  const whExisting = input.existingNodes.find(n => n.type === 'warehouse' && n.id === input.warehouseId);
  if (!whExisting) {
    out.addNodes.push({
      id: input.warehouseId, type: 'warehouse', label: input.warehouseName, x: 0, y: 0,
      data: { code: input.warehouseCode, name: input.warehouseName, ...input.flags, active: true },
      __autoGen: idTag,
    });
  }
```

- [ ] **Step 6.5: Run tests**

```bash
npm run test:presets
```

Expected: 22 passed (19 prior + 3 new). 0 failed.

- [ ] **Step 6.6: Commit**

```bash
git add src/warehouse-presets.js src/warehouse-presets.test.mjs
git commit -m "[TASK] - <TASK-REF> [ADD] orchestrator: warehouse + Stock + Vendors/Customers reuse logic"
```

---

### Task 7: WizardModal scaffold + AddModal hook

**Files:**
- Modify: `odoo-inventory-flow (2).jsx`

This task replaces the `Add → Warehouse` button's behavior with opening a new `WizardModal`. The wizard is empty in this task — it has a header, a Skip link, a Cancel button, and a (disabled) Create button. No fields, no preview, no generation. The form scaffolding lands here.

- [ ] **Step 7.1: Add the import**

Near the top of `odoo-inventory-flow (2).jsx` (after the existing top imports — find a clean spot before the `// ── THEME ─────` comment block):

```js
import { presetGenerator } from "./src/warehouse-presets.js";
```

(Note: the existing file does not use ES imports today; it's a raw .jsx file consumed by `src/main.jsx` which itself uses ES imports. Adding `import` here is safe because esbuild bundles both.)

Verify by looking at the top of the file. If `import React, { useState, useRef ... } from "react"` is already there, the new import line goes alongside it.

- [ ] **Step 7.2: Define `WizardModal` component**

Locate the `AddModal` definition (around line 1033). Add immediately above it:

```js
// ─── WAREHOUSE PRESET WIZARD ────────────────────────────────────────────
const WizardModal = ({ existingNodes, onClose, onSkip, onCreate }) => {
  // Field state — populated in Task 8
  const [code, setCode] = useState("WH");
  const [name, setName] = useState("Main Warehouse");
  // const [flags, setFlags] = useState({...})  ← Task 8

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onClose}>
      <div style={{ width: 720, maxHeight: "85vh", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>New warehouse</span>
          <Btn variant="ghost" small icon="close" onClick={onClose} />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gridTemplateColumns: "1fr 280px", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: T.textSoft, marginBottom: 8 }}>Identity</div>
            <div style={{ fontSize: 11, color: T.textDim }}>Form fields land in Task 8</div>
          </div>
          <div style={{ background: T.surfaceHover, borderRadius: 6, padding: 12, fontSize: 11, color: T.textDim }}>
            Live preview lands in Task 10
          </div>
        </div>
        <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={onSkip} style={{ background: "none", border: "none", color: T.accent, fontSize: 11, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", padding: 0 }}>
            Skip — just add empty WH
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" small onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" small disabled onClick={onCreate}>Create</Btn>
          </div>
        </div>
      </div>
    </div>
  );
};
```

(`Btn` is already an existing component in this file. Use it. If `Btn` doesn't accept `disabled`, replace that prop with conditional styling — verify by grepping `const Btn`.)

- [ ] **Step 7.3: Wire the wizard into the App component**

Find the `App` component (around line 1844 — `function App()` or similar). Locate the `showAdd` state declaration and the existing `{showAdd && <AddModal ...`. Add a new state for the wizard near them:

```js
  const [showWizard, setShowWizard] = useState(false);
```

Then locate the rendered `<AddModal>` (around line 4230). Modify the `onAdd` prop so when type is 'warehouse', it opens the wizard instead:

```jsx
{showAdd && <AddModal
  onAdd={(type) => {
    if (type === 'warehouse') {
      setShowAdd(false);
      setShowWizard(true);
      return;
    }
    doAdd(type);
  }}
  routes={data.routes}
  ...rest of existing props...
/>}
{showWizard && <WizardModal
  existingNodes={data.nodes}
  onClose={() => setShowWizard(false)}
  onSkip={() => { setShowWizard(false); doAdd('warehouse'); }}
  onCreate={() => { /* Task 11 */ }}
/>}
```

(Inline `onAdd` with an arrow because the existing `AddModal` calls `onAdd("warehouse")` from a button click.)

- [ ] **Step 7.4: Build + smoke test**

```bash
npm run build
```

Expected: build succeeds, both bundles produced.

Open `http://localhost:4173`. Click `+` (Add) → click `Warehouse`. Wizard should appear with placeholder text. Click Cancel → closes. Click `+` → `Warehouse` → click Skip — empty WH should be added (existing behaviour). Click `+` → `Location` — should still add a location node (regression check that other types still work).

- [ ] **Step 7.5: Commit**

```bash
git add "odoo-inventory-flow (2).jsx"
git commit -m "[TASK] - <TASK-REF> [ADD] WizardModal scaffold; replace Add → Warehouse with wizard"
```

---

### Task 8: Wizard form fields + smart defaults

**Files:**
- Modify: `odoo-inventory-flow (2).jsx` (`WizardModal` component)

Wire all the form fields. Smart defaults follow the spec:
- `code`: `WH` if no warehouse on canvas, else `WH${count + 1}`.
- `name`: `Main Warehouse` if first, `Secondary Warehouse`, `Tertiary Warehouse`, `Warehouse 4`, etc.
- Flags: defaults match a typical retail warehouse: `reception_steps='one_step'`, `delivery_steps='ship_only'`, `manufacture_to_resupply=false`, `manufacture_steps='mrp_one_step'`, `buy_to_resupply=true`, `resupply_wh_ids=[]`.

`manufacture_steps` field is shown only when `manufacture_to_resupply=true` (progressive disclosure).

- [ ] **Step 8.1: Compute smart defaults**

In `WizardModal`, replace the existing `useState` declarations with:

```js
  const ordinals = ['Main', 'Secondary', 'Tertiary', 'Quaternary', 'Quinary'];
  const existingWarehouses = existingNodes.filter(n => n.type === 'warehouse');
  const wCount = existingWarehouses.length;
  const defaultCode = wCount === 0 ? 'WH' : `WH${wCount + 1}`;
  const defaultName = wCount < ordinals.length
    ? `${ordinals[wCount]} Warehouse`
    : `Warehouse ${wCount + 1}`;

  const [code, setCode] = useState(defaultCode);
  const [name, setName] = useState(defaultName);
  const [flags, setFlags] = useState({
    reception_steps: 'one_step',
    delivery_steps:  'ship_only',
    manufacture_to_resupply: false,
    manufacture_steps: 'mrp_one_step',
    buy_to_resupply: true,
    resupply_wh_ids: [],
  });
```

- [ ] **Step 8.2: Replace the placeholder form with real fields**

Replace the left-column placeholder in `WizardModal`'s body with:

```jsx
<div>
  <div style={{ fontSize: 11, color: T.textSoft, marginBottom: 8, fontWeight: 600 }}>Identity</div>
  <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 8, marginBottom: 16 }}>
    <label style={{ fontSize: 11, color: T.textDim, alignSelf: "center" }}>Code</label>
    <input value={code} onChange={e => setCode(e.target.value)}
      style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 12, padding: "5px 8px", borderRadius: 4, fontFamily: "inherit" }}
      maxLength={5} />
    <label style={{ fontSize: 11, color: T.textDim, alignSelf: "center" }}>Name</label>
    <input value={name} onChange={e => setName(e.target.value)}
      style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 12, padding: "5px 8px", borderRadius: 4, fontFamily: "inherit" }} />
  </div>

  <div style={{ fontSize: 11, color: T.textSoft, marginBottom: 8, fontWeight: 600 }}>Routings</div>
  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, marginBottom: 16 }}>
    <label style={{ fontSize: 11, color: T.textDim, alignSelf: "center" }}>Reception</label>
    <select value={flags.reception_steps} onChange={e => setFlags(f => ({ ...f, reception_steps: e.target.value }))}
      style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 12, padding: "5px 8px", borderRadius: 4, fontFamily: "inherit" }}>
      <option value="one_step">Receive directly (1 step)</option>
      <option value="two_steps">Input → Stock (2 steps)</option>
      <option value="three_steps">Input → QC → Stock (3 steps)</option>
    </select>
    <label style={{ fontSize: 11, color: T.textDim, alignSelf: "center" }}>Delivery</label>
    <select value={flags.delivery_steps} onChange={e => setFlags(f => ({ ...f, delivery_steps: e.target.value }))}
      style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 12, padding: "5px 8px", borderRadius: 4, fontFamily: "inherit" }}>
      <option value="ship_only">Deliver directly (1 step)</option>
      <option value="pick_ship">Pick → Ship (2 steps)</option>
      <option value="pick_pack_ship">Pick → Pack → Ship (3 steps)</option>
    </select>
  </div>

  <div style={{ fontSize: 11, color: T.textSoft, marginBottom: 8, fontWeight: 600 }}>Resupply</div>
  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.text, marginBottom: 8 }}>
    <input type="checkbox" checked={flags.buy_to_resupply}
      onChange={e => setFlags(f => ({ ...f, buy_to_resupply: e.target.checked }))} />
    Buy to resupply
  </label>
  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.text, marginBottom: 8 }}>
    <input type="checkbox" checked={flags.manufacture_to_resupply}
      onChange={e => setFlags(f => ({ ...f, manufacture_to_resupply: e.target.checked }))} />
    Manufacture to resupply
  </label>
  {flags.manufacture_to_resupply && (
    <div style={{ marginLeft: 22, marginBottom: 8 }}>
      <select value={flags.manufacture_steps}
        onChange={e => setFlags(f => ({ ...f, manufacture_steps: e.target.value }))}
        style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 12, padding: "5px 8px", borderRadius: 4, fontFamily: "inherit" }}>
        <option value="mrp_one_step">Manufacture (1 step)</option>
        <option value="pbm">Pick + Manufacture (2 steps)</option>
        <option value="pbm_sam">Pick + Manufacture + Store (3 steps)</option>
      </select>
    </div>
  )}
  {/* Resupply m2m chip picker — Task 9 */}
</div>
```

Also enable the Create button:

```jsx
<Btn variant="primary" small onClick={onCreate}>Create</Btn>
```

(Drop the `disabled` prop. We'll re-add validation in Task 11.)

- [ ] **Step 8.3: Build + smoke test**

```bash
npm run build
```

Open the wizard. Verify:
- Code defaults to `WH` (or `WH2` if a warehouse already exists on canvas).
- Name defaults to `Main Warehouse` (or `Secondary Warehouse`).
- Toggling `Manufacture to resupply` reveals the manufacture_steps dropdown.
- All fields are editable.

- [ ] **Step 8.4: Commit**

```bash
git add "odoo-inventory-flow (2).jsx"
git commit -m "[TASK] - <TASK-REF> [ADD] wizard form fields + smart code/name defaults"
```

---

### Task 9: Resupply m2m chip picker

**Files:**
- Modify: `odoo-inventory-flow (2).jsx` (`WizardModal` component)

Surface only when canvas has another warehouse. Multi-select chip picker.

- [ ] **Step 9.1: Replace the resupply placeholder**

Find `{/* Resupply m2m chip picker — Task 9 */}` and replace with:

```jsx
{existingWarehouses.length > 0 && (
  <div style={{ marginTop: 4 }}>
    <label style={{ fontSize: 11, color: T.textDim, marginBottom: 6, display: "block" }}>
      Resupply from
    </label>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {existingWarehouses.map(wh => {
        const selected = flags.resupply_wh_ids.includes(wh.id);
        return (
          <button key={wh.id} type="button"
            onClick={() => setFlags(f => ({
              ...f,
              resupply_wh_ids: selected
                ? f.resupply_wh_ids.filter(id => id !== wh.id)
                : [...f.resupply_wh_ids, wh.id],
            }))}
            style={{
              padding: "4px 10px", borderRadius: 12, border: `1px solid ${T.border}`,
              background: selected ? T.accentSoft : "transparent",
              color: selected ? T.accent : T.textDim,
              fontSize: 11, fontFamily: "inherit", cursor: "pointer",
            }}>
            {selected ? "✓ " : ""}{wh.data?.code || wh.label} ({wh.label})
          </button>
        );
      })}
    </div>
  </div>
)}
```

- [ ] **Step 9.2: Build + smoke test**

```bash
npm run build
```

Open the canvas with at least one warehouse. Open `Add → Warehouse`. The Resupply chips appear and toggle on click. Open the wizard on a fresh blank canvas — chips do not appear.

- [ ] **Step 9.3: Commit**

```bash
git add "odoo-inventory-flow (2).jsx"
git commit -m "[TASK] - <TASK-REF> [ADD] resupply m2m chip picker (shown when canvas has \\u2265 2 warehouses)"
```

---

### Task 10: Live preview panel

**Files:**
- Modify: `odoo-inventory-flow (2).jsx` (`WizardModal` component)

Right-column panel summarising the entities about to be created. Updates on every flag change. Calls `presetGenerator` to compute, then renders the lists.

- [ ] **Step 10.1: Compute the preview via useMemo**

In `WizardModal`, just below the state declarations, add:

```js
  const preview = useMemo(() => {
    const warehouseId = `wh-${Math.random().toString(36).slice(2, 8)}`; // ephemeral; replaced on Create
    return presetGenerator({
      warehouseId, warehouseCode: code, warehouseName: name,
      flags, existingNodes,
    });
  }, [code, name, flags, existingNodes]);
```

- [ ] **Step 10.2: Replace the right-column placeholder**

Find `Live preview lands in Task 10` and replace the entire right column `<div>` with:

```jsx
<div style={{ background: T.surfaceHover, borderRadius: 6, padding: 12, fontSize: 11, color: T.text, overflow: "auto" }}>
  <div style={{ fontWeight: 700, marginBottom: 8 }}>Will create:</div>

  <div style={{ marginBottom: 6, color: T.textDim }}>Locations ({preview.addNodes.filter(n => n.type === "location").length})</div>
  {preview.addNodes.filter(n => n.type === "location").map(n => (
    <div key={n.id} style={{ paddingLeft: 8, color: T.text, marginBottom: 2 }}>{n.label} <span style={{ color: T.textDim }}>({n.data.usage})</span></div>
  ))}

  <div style={{ marginTop: 10, marginBottom: 6, color: T.textDim }}>Operation types ({preview.addOperationTypes.length})</div>
  {preview.addOperationTypes.map(o => (
    <div key={o.id} style={{ paddingLeft: 8, color: T.text, marginBottom: 2 }}>{o.label} <span style={{ color: T.textDim }}>({o.code})</span></div>
  ))}

  <div style={{ marginTop: 10, marginBottom: 6, color: T.textDim }}>Routes ({preview.addRoutes.length})</div>
  {preview.addRoutes.map(r => (
    <div key={r.id} style={{ paddingLeft: 8, color: T.text, marginBottom: 2 }}>{r.label} <span style={{ color: T.textDim }}>({r.rules.length} rules)</span></div>
  ))}

  {preview.addNodes.length === 0 && preview.addOperationTypes.length === 0 && preview.addRoutes.length === 0 && (
    <div style={{ color: T.textDim, fontStyle: "italic" }}>(empty — toggle some options)</div>
  )}
</div>
```

- [ ] **Step 10.3: Add useMemo to imports if needed**

Check the existing imports near the top of `odoo-inventory-flow (2).jsx`. If `useMemo` isn't already imported from React, add it. The line will look like:

```js
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
```

- [ ] **Step 10.4: Build + smoke test**

```bash
npm run build
```

Open the wizard. As you toggle reception_steps from 1→3, the preview updates: locations grow (Input, Quality Control), op-types grow, routes appear. Toggle manufacture_to_resupply on → preview gains Production + 2-3 op-types + Manufacture route. Edit `code` from `WH` → `WH2` → all preview labels reflect the new code.

- [ ] **Step 10.5: Commit**

```bash
git add "odoo-inventory-flow (2).jsx"
git commit -m "[TASK] - <TASK-REF> [ADD] wizard live-preview panel"
```

---

### Task 11: Create button + mergeWizardOutput dispatcher

**Files:**
- Modify: `odoo-inventory-flow (2).jsx`

Wire the Create button. Validates input, generates the preset, merges it into `data` via the existing history-aware `setData` pattern, then auto-layouts.

- [ ] **Step 11.1: Define `mergeWizardOutput` inside `App`**

Inside the `App` component, near `doAdd` (search for `const doAdd = `), add:

```js
  const mergeWizardOutput = useCallback((input) => {
    const out = presetGenerator(input);
    setData(p => {
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
      return {
        ...p,
        nodes: [...p.nodes, ...out.addNodes],
        operationTypes: [...p.operationTypes, ...out.addOperationTypes],
        routes: [...p.routes, ...out.addRoutes],
      };
    });
    setTimeout(() => { autoLayout(); fitToContent(); }, 50);
  }, [autoLayout, fitToContent]);
```

If `historyRef`, `futureRef`, `setCanUndo`, `setCanRedo` aren't named that way, grep for `historyRef.current = [...historyRef.current.slice` in the file to see the canonical pattern, and copy it exactly.

- [ ] **Step 11.2: Wire the wizard's onCreate**

Find the `<WizardModal ... onCreate={...} />` JSX and update:

```jsx
{showWizard && <WizardModal
  existingNodes={data.nodes}
  onClose={() => setShowWizard(false)}
  onSkip={() => { setShowWizard(false); doAdd('warehouse'); }}
  onCreate={(payload) => {
    setShowWizard(false);
    mergeWizardOutput(payload);
  }}
/>}
```

- [ ] **Step 11.3: Make the wizard's Create button send the payload**

In `WizardModal`, change the Create button to:

```jsx
<Btn variant="primary" small onClick={() => {
  if (!code.trim() || !name.trim()) return;
  const warehouseId = `wh-${Math.random().toString(36).slice(2, 8)}`;
  // Re-resolve existing-warehouse code collisions
  const codeTaken = existingNodes.some(n => n.type === 'warehouse' && (n.data?.code || '').toUpperCase() === code.trim().toUpperCase());
  if (codeTaken) { alert(`Warehouse code "${code}" already in use`); return; }
  onCreate({
    warehouseId, warehouseCode: code.trim(), warehouseName: name.trim(),
    flags, existingNodes,
  });
}}>Create</Btn>
```

- [ ] **Step 11.4: Build + manual test**

```bash
npm run build
```

In the browser:
- Open the wizard on a fresh canvas (or click `New` to clear). Defaults `WH`/`Main Warehouse`. All flags off.
- Click **Create**. Single warehouse + Vendors + Stock + Customers + 1 Receipts op-type + 1 Delivery op-type appear. Auto-layout fires. `fitToContent` zooms in.
- Hit Ctrl+Z. The 4-5 nodes disappear. Ctrl+Y restores.
- Re-open the wizard, change reception_steps to 3 and delivery_steps to 3 and manufacture on, click Create. Many more entities appear, neatly laid out by lane.
- Try entering a duplicate code — alert appears.
- Try blank code — Create silently does nothing.

- [ ] **Step 11.5: Commit**

```bash
git add "odoo-inventory-flow (2).jsx"
git commit -m "[TASK] - <TASK-REF> [ADD] wizard Create button + mergeWizardOutput dispatcher"
```

---

### Task 12: Manual verification matrix

**Files:**
- None (verification only)

Run through the verification matrix from the spec.

- [ ] **Step 12.1: Empty canvas, minimal flags**

Click `New` → `Add → Warehouse` → defaults → Create. Verify: 1 warehouse, Vendors, Customers, WH/Stock, Receipts op-type, Delivery Orders op-type, Buy route. Auto-layout produces a clean center-axis row.

- [ ] **Step 12.2: Empty canvas, max-flag warehouse**

Click `New` → `Add → Warehouse` → set reception=3, delivery=3, manufacture=on (pbm_sam), buy=on → Create. Verify: matches the bundled "Full Demo Warehouse" template visually (5 routes, 10 op-types, ~10 locations).

- [ ] **Step 12.3: Two-warehouse + resupply**

Apply the "Full Demo Warehouse" template via `Add → From Template`. Then `Add → Warehouse` → set code=WH2, name=Secondary, reception=1, delivery=1, buy=on, **resupply_wh_ids=[wh1]** → Create. Verify:
- Vendors and Customers were reused (no Vendors2 / Customers2 on canvas).
- New `WH2/Stock` location.
- New `WH2/Transit (from WH)` location with usage='transit'.
- New `Receipts from WH` op-type tagged to wh2.
- New `Send to WH2` op-type tagged to wh1.
- New "Resupply from WH" route w/ 2 rules.
- The transit location appears between WH2/Stock and WH/Stock when auto-layout fires.

- [ ] **Step 12.4: Skip path**

Click `Add → Warehouse` → click `Skip — just add empty WH`. A single empty warehouse node is added (legacy behaviour). No locations, no routes, no op-types created.

- [ ] **Step 12.5: JSON round-trip**

Export the canvas (Export button). Verify the JSON contains `__autoGen` tags on nodes/op-types/routes generated by the wizard. Reload the page (canvas resets to default). Import the saved JSON. Verify all `__autoGen` tags survive.

- [ ] **Step 12.6: Build clean**

```bash
npm run build && npm run test:presets
```

Both must succeed with no errors.

- [ ] **Step 12.7: Commit (no-op if no changes)**

If you made any tweaks during verification:

```bash
git add -p
git commit -m "[TASK] - <TASK-REF> [FIX] manual-verification adjustments to wizard"
```

---

### Task 13: Roadmap update + close out

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 13.1: Update CLAUDE.md**

In the existing `## Roadmap (post-audit)` section, find the "Next-up scope (May 2026)" sub-section and modify the **Warehouse-creation presets** bullet:

Old:
```
- **Warehouse-creation presets (Odoo-parity wizard)** — when adding a new warehouse, surface the same option flags Odoo offers ...
```

New:
```
- ✅ **Warehouse-creation presets — Plan A (creation only)** — wizard for `Add → Warehouse` with reception_steps/delivery_steps/manufacture/buy/resupply flags. Pure-function generators in `src/warehouse-presets.js`. Provenance via `__autoGen = { warehouseId, source }` tags. **Plan B (live regen on field edits)** and **Plan C ("Create in Odoo" mode)** are still pending.
```

Add a new sub-section near the top of `## Architecture`:

```
**Provenance tags** — Entities created by the warehouse-preset wizard carry `__autoGen = { warehouseId, source }` where `source ∈ { 'identity' | 'reception_steps' | 'delivery_steps' | 'manufacture' | 'buy' | 'resupply:<wh_id>' }`. Round-trips through the JSON export. Used by future Plans B/C for shrink-detection and "Create in Odoo" reconciliation.
```

- [ ] **Step 13.2: Verify both bundles still build clean**

```bash
npm run build && npm run test:presets
```

- [ ] **Step 13.3: Commit**

```bash
git add CLAUDE.md
git commit -m "[TASK] - <TASK-REF> [DOC] mark Plan A landed; document __autoGen provenance"
```

- [ ] **Step 13.4: Push to remote**

Only if you/Brecht intend to push — confirm before:

```bash
git push -u origin <branch-name>
```

---

## Self-review

Spec coverage check:

| Spec section | Implemented in |
|---|---|
| `presetGenerator` pure function | Tasks 1-6 |
| Per-flag generators (reception / delivery / manufacture / buy / resupply) | Tasks 1, 2, 3, 4, 5 |
| Vendors/Customers reuse logic | Task 6 |
| Two-sided resupply tagging (target.tag for transit/IN/route, source.tag for OUT) | Task 5 |
| `__autoGen` tags on every generated entity | All generation tasks |
| `WizardModal` UI scaffold | Task 7 |
| Smart name/code defaults (`WH<n>` / `Secondary Warehouse`…) | Task 8 |
| Resupply m2m chip picker (only ≥2 warehouses) | Task 9 |
| Live preview panel | Task 10 |
| Auto-layout on Create + history-aware merge | Task 11 |
| Skip link → falls back to today's "empty WH" behaviour | Tasks 7 + 11 |
| Manual verification matrix | Task 12 |

Plan B (live regen) and Plan C ("Create in Odoo") deliberately not in this plan — they will be separate plans. The spec section "Edit mode — user changes a wizard-managed field" maps to Plan B; the spec section "Optional 'Create in Odoo' mode" maps to Plan C.

Placeholder scan: every task has full code blocks. No "TBD", no "implement appropriate", no "similar to". The only placeholder is `<TASK-REF>` for the Odoo task number, which is documented at the top of the plan and must be resolved before the first commit.

Type consistency: `presetGenerator` signature is identical across all tasks. The `__autoGen` shape `{ warehouseId, source }` is identical. The output shape `{ addNodes, addOperationTypes, addRoutes }` is identical. Helper functions (`_genReception`, `_genDelivery`, etc.) all return the same shape.
