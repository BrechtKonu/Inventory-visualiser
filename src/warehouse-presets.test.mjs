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

await flush();
