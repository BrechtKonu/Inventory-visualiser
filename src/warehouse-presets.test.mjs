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

// ── presetDiff (Plan B) ─────────────────────────────────────

import { presetDiff } from './warehouse-presets.js';

const sampleData = (overrides = {}) => {
  // Generate a 3-step receive warehouse, then represent it as data
  const r = presetGenerator({
    warehouseId: 'wh1', warehouseCode: 'WH', warehouseName: 'Main',
    flags: { reception_steps: 'three_steps', delivery_steps: 'ship_only',
             manufacture_to_resupply: false, manufacture_steps: 'mrp_one_step',
             buy_to_resupply: false, resupply_wh_ids: [] },
    existingNodes: [],
  });
  return {
    nodes: r.addNodes,
    operationTypes: r.addOperationTypes,
    routes: r.addRoutes,
    putawayRules: [],
    ...overrides,
  };
};

it('presetDiff: shrink reception 3→1 marks Input + QC for removal', () => {
  const data = sampleData();
  const diff = presetDiff(data, 'wh1',
    { reception_steps: 'one_step', delivery_steps: 'ship_only',
      manufacture_to_resupply: false, manufacture_steps: 'mrp_one_step',
      buy_to_resupply: false, resupply_wh_ids: [] },
    'WH', 'Main');
  // Locations Input + QC orphaned
  const removedLabels = diff.toRemove.nodeIds
    .map(id => data.nodes.find(n => n.id === id)?.label).sort();
  assert.deepEqual(removedLabels, ['WH/Input', 'WH/Quality Control']);
  // The receive route (3 rules) is orphaned
  assert.equal(diff.toRemove.routeIds.length, 1);
  assert.equal(diff.toRemove.ruleIds.length, 3);
  // No external refs in this clean shrink
  assert.equal(diff.externalRefs.length, 0);
});

it('presetDiff: shrink reception 3→1 with external rule referencing Input → externalRefs populated', () => {
  const data = sampleData();
  // Add a manual rule on a separate route that points at WH/Input
  data.routes.push({
    id: 'manual-route', label: 'Manual route', colorIdx: 7,
    data: { name: 'Manual route', active: true, product_selectable: false,
            product_categ_selectable: false, warehouse_selectable: true, sale_selectable: false },
    rules: [{ id: 'manual-rl', label: 'External ref to Input',
              action: 'pull', procure_method: 'make_to_order',
              src_location_id: 'wh1-input', dest_location_id: 'wh1-stock',
              picking_type_id: 'op-other', auto: 'manual',
              data: { name: 'External ref to Input', action: 'pull',
                      procure_method: 'make_to_order', auto: 'manual',
                      propagate_cancel: false, delay: 0 } }],
  });
  const diff = presetDiff(data, 'wh1',
    { reception_steps: 'one_step', delivery_steps: 'ship_only',
      manufacture_to_resupply: false, manufacture_steps: 'mrp_one_step',
      buy_to_resupply: false, resupply_wh_ids: [] },
    'WH', 'Main');
  assert.equal(diff.externalRefs.length, 1);
  assert.equal(diff.externalRefs[0].orphanLabel, 'WH/Input');
  assert.equal(diff.externalRefs[0].referencedBy[0].id, 'manual-rl');
});

it('presetDiff: pure grow (1→3) → toAdd populated, toRemove empty', () => {
  const data1Step = (() => {
    const r = presetGenerator({
      warehouseId: 'wh1', warehouseCode: 'WH', warehouseName: 'Main',
      flags: { reception_steps: 'one_step', delivery_steps: 'ship_only',
               manufacture_to_resupply: false, manufacture_steps: 'mrp_one_step',
               buy_to_resupply: false, resupply_wh_ids: [] },
      existingNodes: [],
    });
    return { nodes: r.addNodes, operationTypes: r.addOperationTypes, routes: r.addRoutes, putawayRules: [] };
  })();
  const diff = presetDiff(data1Step, 'wh1',
    { reception_steps: 'three_steps', delivery_steps: 'ship_only',
      manufacture_to_resupply: false, manufacture_steps: 'mrp_one_step',
      buy_to_resupply: false, resupply_wh_ids: [] },
    'WH', 'Main');
  // 2 new locations (Input + QC) + 2 new op-types (QC, Storage; Receipts is replaced) + 1 new route
  assert.equal(diff.toAdd.nodes.length, 2);
  assert.ok(diff.toAdd.routes.length >= 1);
  // Receipts op-type id is the same in both flag states, so toAdd should NOT contain it
  assert.equal(diff.toAdd.operationTypes.filter(o => o.label === 'Receipts').length, 0);
  // Remove should be empty (Receipts changes its dest but the id stays)
  assert.deepEqual(diff.toRemove.nodeIds, []);
});

// ── location-tree ─────────────────────────────────────────────

import { childrenOf, descendantsOf, ancestorPath, isDescendantOf, hasCycle } from './location-tree.js';

const sampleTree = () => [
  { id: 'wh-stock', type: 'location', label: 'WH/Stock', data: { usage: 'internal' } },
  { id: 'shelf-a',  type: 'location', label: 'Shelf A',  data: { usage: 'internal', location_id: 'wh-stock' } },
  { id: 'bin-a1',   type: 'location', label: 'Bin 1',    data: { usage: 'internal', location_id: 'shelf-a' } },
  { id: 'bin-a2',   type: 'location', label: 'Bin 2',    data: { usage: 'internal', location_id: 'shelf-a' } },
  { id: 'shelf-b',  type: 'location', label: 'Shelf B',  data: { usage: 'internal', location_id: 'wh-stock' } },
  { id: 'wh-input', type: 'location', label: 'WH/Input', data: { usage: 'internal' } },
];

it('childrenOf: top-level returns nodes with no location_id', () => {
  const kids = childrenOf(sampleTree(), null);
  assert.deepEqual(kids.map(n => n.id).sort(), ['wh-input', 'wh-stock']);
});

it('childrenOf: returns direct kids only', () => {
  const kids = childrenOf(sampleTree(), 'wh-stock');
  assert.deepEqual(kids.map(n => n.id).sort(), ['shelf-a', 'shelf-b']);
});

it('descendantsOf: returns transitive descendants', () => {
  const desc = descendantsOf(sampleTree(), 'wh-stock');
  assert.deepEqual(desc.map(n => n.id).sort(), ['bin-a1', 'bin-a2', 'shelf-a', 'shelf-b']);
});

it('descendantsOf: leaf returns empty', () => {
  assert.deepEqual(descendantsOf(sampleTree(), 'bin-a1'), []);
});

it('ancestorPath: leaf to root inclusive', () => {
  const path = ancestorPath(sampleTree(), 'bin-a1');
  assert.deepEqual(path.map(n => n.id), ['wh-stock', 'shelf-a', 'bin-a1']);
});

it('isDescendantOf: bin under stock', () => {
  assert.equal(isDescendantOf(sampleTree(), 'bin-a1', 'wh-stock'), true);
  assert.equal(isDescendantOf(sampleTree(), 'wh-stock', 'bin-a1'), false);
  assert.equal(isDescendantOf(sampleTree(), 'wh-stock', 'wh-stock'), false);
});

it('hasCycle: detects parent-loop', () => {
  const cyclic = [
    { id: 'a', type: 'location', label: 'A', data: { usage: 'internal', location_id: 'b' } },
    { id: 'b', type: 'location', label: 'B', data: { usage: 'internal', location_id: 'a' } },
  ];
  assert.equal(hasCycle(cyclic, 'a'), true);
  assert.equal(hasCycle(sampleTree(), 'bin-a1'), false);
});

// ── putaway simulator ─────────────────────────────────────────

import { simulatePutaway } from './putaway-simulator.js';

const simData = () => ({
  nodes: [
    { id: 'wh-stock', type: 'location', label: 'WH/Stock', data: { usage: 'internal', complete_name: 'WH/Stock' } },
    { id: 'shelf-a',  type: 'location', label: 'Shelf A',  data: { usage: 'internal', location_id: 'wh-stock', barcode: 'A', capacity_qty: 50 } },
    { id: 'shelf-b',  type: 'location', label: 'Shelf B',  data: { usage: 'internal', location_id: 'wh-stock', barcode: 'B', capacity_qty: 50 } },
  ],
  putawayRules: [
    { id: 'pa-1', location_in_id: 'wh-stock', location_out_id: 'shelf-a', product: 'Office Desk', category: '', sequence: 1, storage_strategy: 'manual_no_strategy' },
    { id: 'pa-2', location_in_id: 'wh-stock', location_out_id: 'shelf-b', product: '', category: 'Electronics', sequence: 2, storage_strategy: 'manual_no_strategy' },
    { id: 'pa-3', location_in_id: 'wh-stock', location_out_id: 'wh-stock', product: '', category: 'All', sequence: 99, storage_strategy: 'closest_location' },
  ],
});

it('simulatePutaway: matches by product first', () => {
  const r = simulatePutaway(simData(), { product: 'Office Desk', category: '', location_in_id: 'wh-stock', qty: 5 });
  assert.equal(r.matched.id, 'pa-1');
  assert.equal(r.resolvedLocationId, 'shelf-a');
});

it('simulatePutaway: matches by category when no product', () => {
  const r = simulatePutaway(simData(), { product: '', category: 'Electronics', location_in_id: 'wh-stock', qty: 1 });
  assert.equal(r.matched.id, 'pa-2');
  assert.equal(r.resolvedLocationId, 'shelf-b');
});

it('simulatePutaway: wildcard catches all when nothing else matches', () => {
  const r = simulatePutaway(simData(), { product: 'Random', category: 'Random', location_in_id: 'wh-stock', qty: 1 });
  assert.equal(r.matched.id, 'pa-3');
  // closest_location strategy on wh-stock's children → Shelf A (alphabetic by barcode)
  assert.equal(r.resolvedLocationId, 'shelf-a');
});

it('simulatePutaway: capacity check ok when quants present', () => {
  const data = simData();
  data._quantsByLocation = { 'shelf-a': 10 };
  const r = simulatePutaway(data, { product: 'Office Desk', category: '', location_in_id: 'wh-stock', qty: 5 });
  assert.equal(r.capacityCheck, 'ok');
  assert.equal(r.currentQty, 10);
  assert.equal(r.capacityQty, 50);
});

it('simulatePutaway: capacity over when exceeded', () => {
  const data = simData();
  data._quantsByLocation = { 'shelf-a': 48 };
  const r = simulatePutaway(data, { product: 'Office Desk', category: '', location_in_id: 'wh-stock', qty: 5 });
  assert.equal(r.capacityCheck, 'over');
});

it('simulatePutaway: capacity unknown without quants', () => {
  const r = simulatePutaway(simData(), { product: 'Office Desk', category: '', location_in_id: 'wh-stock', qty: 5 });
  assert.equal(r.capacityCheck, 'unknown');
});

it('simulatePutaway: no rules → null match', () => {
  const r = simulatePutaway(simData(), { product: 'X', category: 'Y', location_in_id: 'unknown-loc', qty: 1 });
  assert.equal(r.matched, null);
  assert.equal(r.resolvedLocationId, null);
});

it('simulatePutaway: per-product capacity from storage category wins over location capacity', () => {
  const data = simData();
  // Add a storage category with a per-product capacity for Office Desk = 1
  data.storageCategories = [
    { id: 'cat-pallet', name: 'Pallet', allow_new_product: 'same_product', max_weight: 500, capacity_qty: 1,
      capacity_ids: [{ product: 'Office Desk', qty: 1 }] },
  ];
  // Tag shelf-a with the category. Override its capacity_qty so we can prove
  // the per-product rule wins over the location's own capacity.
  data.nodes = data.nodes.map(n => n.id === 'shelf-a'
    ? { ...n, data: { ...n.data, storage_category_id: 'cat-pallet', capacity_qty: 999 } }
    : n);
  data._quantsByLocation = { 'shelf-a': 0 };
  // Putting 2 desks in a 1-cap-per-product slot → over.
  const r = simulatePutaway(data, { product: 'Office Desk', category: '', location_in_id: 'wh-stock', qty: 2 });
  assert.equal(r.capacityCheck, 'over');
  assert.equal(r.capacityQty, 1);
  // And the trace mentions the per-product source.
  assert.ok(r.trace.some(t => t.includes('per-product capacity')), `trace should mention per-product capacity. got: ${r.trace.join(' | ')}`);
});

it('simulatePutaway: falls back to category default when no per-product entry', () => {
  const data = simData();
  data.storageCategories = [
    { id: 'cat-bin', name: 'Bin', allow_new_product: 'mixed_products', max_weight: 50, capacity_qty: 50, capacity_ids: [] },
  ];
  data.nodes = data.nodes.map(n => n.id === 'shelf-b'
    ? { ...n, data: { ...n.data, storage_category_id: 'cat-bin', capacity_qty: 999 } }
    : n);
  data._quantsByLocation = { 'shelf-b': 40 };
  const r = simulatePutaway(data, { product: 'Random', category: 'Electronics', location_in_id: 'wh-stock', qty: 5 });
  assert.equal(r.capacityQty, 50, 'should use category default 50, not location 999');
  assert.equal(r.capacityCheck, 'ok'); // 40 + 5 = 45 < 50
});

// ── vsdx-exporter tests ─────────────────────────────────────────────────
import { exportVsdx } from './vsdx-exporter.js';

const vsdxData = () => ({
  nodes: [
    { id: 'n-stock',   type: 'location',  label: 'Stock',     x: 100, y: 100, data: { usage: 'internal' } },
    { id: 'n-cust',    type: 'location',  label: 'Customers', x: 400, y: 100, data: { usage: 'customer' } },
    { id: 'n-vendor',  type: 'location',  label: 'Vendors',   x: 0,   y: 100, data: { usage: 'supplier' } },
    { id: 'n-wh',      type: 'warehouse', label: 'WH',        x: 50,  y: 300, data: { code: 'WH' } },
    // Sub-location: should be skipped on top-level page.
    { id: 'n-bin',     type: 'location',  label: 'Bin A',     x: 200, y: 200, data: { usage: 'internal', location_id: 'n-stock' } },
  ],
  routes: [
    { id: 'r1', name: 'Ship', rules: [
      { src_location_id: 'n-stock', dest_location_id: 'n-cust', action: 'pull', label: 'ship' },
    ]},
  ],
  operationTypes: [],
  putawayRules: [],
  storageCategories: [],
});

// Minimal in-process ZIP reader: scans EOCD, walks central dir, returns name → bytes.
const readZip = (u8) => {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // Find EOCD (0x06054b50) — scan from end.
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no EOCD');
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const entries = {};
  let p = cdOffset;
  while (p < cdOffset + cdSize) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central dir sig');
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    // Read local header to find data start.
    if (dv.getUint32(localOff, true) !== 0x04034b50) throw new Error('bad local sig');
    const lhNameLen = dv.getUint16(localOff + 26, true);
    const lhExtraLen = dv.getUint16(localOff + 28, true);
    const dataLen = dv.getUint32(localOff + 22, true);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    entries[name] = u8.subarray(dataStart, dataStart + dataLen);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return entries;
};

it('vsdx: produces a valid ZIP with all 7 OOXML parts', async () => {
  const blob = exportVsdx(vsdxData());
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const entries = readZip(u8);
  for (const name of [
    '[Content_Types].xml',
    '_rels/.rels',
    'visio/document.xml',
    'visio/_rels/document.xml.rels',
    'visio/pages/pages.xml',
    'visio/pages/_rels/pages.xml.rels',
    'visio/pages/page1.xml',
  ]) {
    assert.ok(entries[name], `missing part: ${name}`);
  }
});

it('vsdx: page1 includes shapes for every top-level node and an edge per rule', async () => {
  const blob = exportVsdx(vsdxData());
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const page1 = new TextDecoder().decode(readZip(u8)['visio/pages/page1.xml']);
  // 4 top-level nodes (sub-location skipped) + 1 connector
  const shapeCount = (page1.match(/<Shape /g) || []).length;
  assert.equal(shapeCount, 5, `expected 5 shapes (4 nodes + 1 connector), got ${shapeCount}`);
  assert.ok(page1.includes('<Text>Stock</Text>'),     'Stock label present');
  assert.ok(page1.includes('<Text>Customers</Text>'), 'Customers label present');
  assert.ok(page1.includes("OneD' V='1'"),            'connector marked one-dimensional');
});

it('vsdx: skips sub-locations from the top-level page', async () => {
  const blob = exportVsdx(vsdxData());
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const page1 = new TextDecoder().decode(readZip(u8)['visio/pages/page1.xml']);
  assert.ok(!page1.includes('<Text>Bin A</Text>'), 'Bin A (sub-location) should not appear on top-level page');
});

it('vsdx: empty data still produces a valid file (placeholder shape)', async () => {
  const blob = exportVsdx({ nodes: [], routes: [], operationTypes: [], putawayRules: [] });
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const entries = readZip(u8);
  assert.ok(entries['visio/pages/page1.xml'], 'page1 present');
  const page1 = new TextDecoder().decode(entries['visio/pages/page1.xml']);
  assert.ok(page1.includes('(empty)'), 'placeholder shape rendered');
});

it('vsdx: XML-escapes label text', async () => {
  const data = vsdxData();
  data.nodes[0].label = 'Stock <A&B> "main"';
  const blob = exportVsdx(data);
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const page1 = new TextDecoder().decode(readZip(u8)['visio/pages/page1.xml']);
  assert.ok(page1.includes('Stock &lt;A&amp;B&gt; &quot;main&quot;'), 'label escaped');
  assert.ok(!page1.includes('<A&B>'), 'raw <A&B> must not leak');
});

await flush();
