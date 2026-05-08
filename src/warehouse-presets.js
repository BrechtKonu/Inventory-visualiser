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
  // Resolve common ids: vendors/customers (existing or fallback), stock (assumed to exist with id `<wid>-stock`)
  const vendorsExisting = _findByUsage(input.existingNodes, 'supplier');
  const customersExisting = _findByUsage(input.existingNodes, 'customer');
  const stockExisting = input.existingNodes.find(n =>
    n.type === 'location' && n.data?.usage === 'internal' &&
    n.id === `${input.warehouseId}-stock`);
  const ctx = {
    vendorsId: vendorsExisting?.id ?? 'loc-vendors',
    customersId: customersExisting?.id ?? 'loc-customers',
    stockId: stockExisting?.id ?? `${input.warehouseId}-stock`,
    routeColorBase: 0,
  };
  if (input.flags?.reception_steps) {
    const r = _genReception(input, ctx);
    out.addNodes.push(...r.addNodes);
    out.addOperationTypes.push(...r.addOperationTypes);
    out.addRoutes.push(...r.addRoutes);
  }
  if (input.flags?.delivery_steps) {
    const r = _genDelivery(input, ctx);
    out.addNodes.push(...r.addNodes);
    out.addOperationTypes.push(...r.addOperationTypes);
    out.addRoutes.push(...r.addRoutes);
  }
  if (input.flags?.manufacture_to_resupply) {
    const r = _genManufacture(input, ctx);
    out.addNodes.push(...r.addNodes);
    out.addOperationTypes.push(...r.addOperationTypes);
    out.addRoutes.push(...r.addRoutes);
  }
  if (input.flags?.buy_to_resupply) {
    const r = _genBuy(input, ctx);
    out.addNodes.push(...r.addNodes);
    out.addOperationTypes.push(...r.addOperationTypes);
    out.addRoutes.push(...r.addRoutes);
  }
  if (Array.isArray(input.flags?.resupply_wh_ids) && input.flags.resupply_wh_ids.length > 0) {
    const r = _genResupply(input, ctx);
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

const _rule = (id, label, action, procure, srcId, dstId, otId, auto = 'manual', delay = 0, autoGen, propagate_cancel = false) => ({
  id, label, action, procure_method: procure,
  src_location_id: srcId, dest_location_id: dstId, picking_type_id: otId, auto,
  data: { name: label, action, procure_method: procure, auto, propagate_cancel, delay },
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
  // Route color offset: reception=+0, delivery=+1, manufacture=+2, buy=+4, resupply=+5+idx.
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

function _genManufacture(input, ctx) {
  const { warehouseId: wid, warehouseCode: code, flags } = input;
  if (!flags.manufacture_to_resupply) return { addNodes: [], addOperationTypes: [], addRoutes: [] };
  const tag = _internal._autoTag(wid, 'manufacture');
  // Route color offset: reception=+0, delivery=+1, manufacture=+2, buy=+4, resupply=+5+idx.
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
          prodId, stockId, opS.id, pushAuto, 0, tag, isSam),
      ], { product_selectable: true, product_categ_selectable: true }, tag),
    ],
  };
}

function _genBuy(input, ctx) {
  const { warehouseId: wid, flags } = input;
  if (!flags.buy_to_resupply) return { addNodes: [], addOperationTypes: [], addRoutes: [] };
  const tag = _internal._autoTag(wid, 'buy');
  // Route color offset: reception=+0, delivery=+1, manufacture=+2, buy=+4, resupply=+5+idx.
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

function _resolveSourceStockId(existingNodes, sourceWid) {
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
      // Route color offset: reception=+0, delivery=+1, manufacture=+2, buy=+4, resupply=+5+idx.
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

function _genDelivery(input, ctx) {
  const { warehouseId: wid, warehouseCode: code, flags } = input;
  const stockId = ctx.stockId;
  const customersId = ctx.customersId;
  const tag = _internal._autoTag(wid, 'delivery_steps');
  // Route color offset: reception=+0, delivery=+1, manufacture=+2, buy=+4, resupply=+5+idx.
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
