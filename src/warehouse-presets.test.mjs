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
  // Identity emissions happen even with empty flags; only flag-driven generators are silent.
  assert.equal(r.addOperationTypes.filter(o => o.__autoGen?.source !== 'identity').length, 0);
  assert.equal(r.addRoutes.filter(rt => rt.__autoGen?.source !== 'identity').length, 0);
});

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
  const recvNodes  = r.addNodes.filter(n => n.__autoGen?.source === 'reception_steps');
  const recvOps    = r.addOperationTypes.filter(o => o.__autoGen?.source === 'reception_steps');
  const recvRoutes = r.addRoutes.filter(rt => rt.__autoGen?.source === 'reception_steps');
  assert.equal(recvNodes.length, 0, 'no new locations');
  assert.equal(recvOps.length, 1, 'one op-type (Receipts)');
  assert.equal(recvOps[0].label, 'Receipts');
  assert.equal(recvOps[0].src_location_id, 'loc-vendors');
  assert.equal(recvOps[0].dest_location_id, 'wh1-stock');
  assert.equal(recvOps[0].__autoGen.source, 'reception_steps');
  assert.equal(recvRoutes.length, 0, 'no route for 1-step (op-type alone is enough)');
});

it('reception_steps=two_steps adds Input + 2 op-types + 1 route w/ 2 rules', () => {
  const r = presetGenerator(ctx({ flags: { ...ctx().flags, reception_steps: 'two_steps' } }));
  const recvNodes  = r.addNodes.filter(n => n.__autoGen?.source === 'reception_steps');
  const recvOps    = r.addOperationTypes.filter(o => o.__autoGen?.source === 'reception_steps');
  const recvRoutes = r.addRoutes.filter(rt => rt.__autoGen?.source === 'reception_steps');
  assert.equal(recvNodes.length, 1);
  assert.equal(recvNodes[0].label, 'WH/Input');
  assert.equal(recvNodes[0].data.usage, 'internal');
  assert.equal(recvNodes[0].__autoGen.source, 'reception_steps');
  assert.equal(recvOps.length, 2);
  assert.deepEqual(recvOps.map(o => o.label), ['Receipts', 'Storage']);
  assert.equal(recvRoutes.length, 1);
  assert.equal(recvRoutes[0].rules.length, 2);
  // MTO chain ending in MTS
  assert.equal(recvRoutes[0].rules[0].procure_method, 'make_to_order');
  assert.equal(recvRoutes[0].rules[1].procure_method, 'make_to_stock');
});

it('reception_steps=three_steps adds Input + QC + 3 op-types + 1 route w/ 3 rules', () => {
  const r = presetGenerator(ctx({ flags: { ...ctx().flags, reception_steps: 'three_steps' } }));
  const recvNodes  = r.addNodes.filter(n => n.__autoGen?.source === 'reception_steps');
  const recvOps    = r.addOperationTypes.filter(o => o.__autoGen?.source === 'reception_steps');
  const recvRoutes = r.addRoutes.filter(rt => rt.__autoGen?.source === 'reception_steps');
  assert.equal(recvNodes.length, 2);
  assert.deepEqual(recvNodes.map(n => n.label).sort(), ['WH/Input', 'WH/Quality Control']);
  assert.equal(recvOps.length, 3);
  assert.deepEqual(recvOps.map(o => o.label), ['Receipts', 'Quality Check', 'Storage']);
  assert.equal(recvRoutes.length, 1);
  assert.equal(recvRoutes[0].rules.length, 3);
  assert.equal(recvRoutes[0].rules[2].procure_method, 'make_to_stock');
});

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
  const lastPbm = mr[0].rules[mr[0].rules.length - 1];
  assert.equal(lastPbm.data.propagate_cancel, false);
});

it('manufacture pbm_sam: Post-Production rule is auto=transparent push', () => {
  const r = presetGenerator(ctx({ flags: { ...ctx().flags,
    manufacture_to_resupply: true, manufacture_steps: 'pbm_sam' } }));
  const mr = r.addRoutes.find(rt => rt.__autoGen?.source === 'manufacture');
  const last = mr.rules[mr.rules.length - 1];
  assert.equal(last.action, 'push');
  assert.equal(last.auto, 'transparent');
  assert.equal(last.data.propagate_cancel, true);
});

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
  assert.equal(route.rules[0].src_location_id, 'wh1-stock');
  assert.equal(route.rules[0].dest_location_id, route.rules[1].src_location_id, 'rule 2 src = rule 1 dst (Transit)');
  assert.equal(route.rules[1].dest_location_id, 'wh2-stock');
});

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
  assert.equal(r.addNodes.filter(n => n.label === 'Vendors').length, 0);
  assert.equal(r.addNodes.filter(n => n.label === 'Customers').length, 0);
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

await flush();
