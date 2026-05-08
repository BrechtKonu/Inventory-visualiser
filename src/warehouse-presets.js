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
  const out = { addNodes: [], addOperationTypes: [], addRoutes: [] };
  // Resolve common ids: vendors (existing or to-be-created), stock (assumed to exist with id `<wid>-stock`)
  const vendorsExisting = _findByUsage(input.existingNodes, 'supplier');
  const stockExisting = input.existingNodes.find(n =>
    n.type === 'location' && n.data?.usage === 'internal' &&
    n.id === `${input.warehouseId}-stock`);
  const ctx = {
    vendorsId: vendorsExisting?.id ?? 'loc-vendors',
    stockId: stockExisting?.id ?? `${input.warehouseId}-stock`,
    routeColorBase: 0,
  };
  if (input.flags?.reception_steps) {
    const r = _genReception(input, ctx);
    out.addNodes.push(...r.addNodes);
    out.addOperationTypes.push(...r.addOperationTypes);
    out.addRoutes.push(...r.addRoutes);
  }
  return out;
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
