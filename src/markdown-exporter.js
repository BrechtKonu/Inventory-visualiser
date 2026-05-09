// Copyright (c) 2026 Dinsdag BV. All rights reserved.
// Pure-function: transforms canvas data into a single Markdown document
// suitable as project handover documentation.

export function exportMarkdown(data, meta = {}) {
  const lines = [];
  const now = new Date().toISOString().slice(0, 10);
  const title = meta.title || 'Warehouse Setup';

  lines.push(`# ${title}`, '');
  lines.push(`_Generated ${now} from the Inventory Visualiser._`, '');
  lines.push('---', '');

  // Warehouses table
  const warehouses = data.nodes.filter(n => n.type === 'warehouse');
  if (warehouses.length) {
    lines.push('## Warehouses', '');
    lines.push('| Code | Name | Reception | Delivery | Manufacture | Buy | Resupply from |');
    lines.push('|------|------|-----------|----------|-------------|-----|---------------|');
    for (const wh of warehouses) {
      const d = wh.data || {};
      const recvLabel = { one_step: '1-step', two_steps: '2-step (Input→Stock)', three_steps: '3-step (Input→QC→Stock)' }[d.reception_steps] || d.reception_steps || '–';
      const dlvLabel = { ship_only: '1-step', pick_ship: '2-step (Pick→Ship)', pick_pack_ship: '3-step (Pick→Pack→Ship)' }[d.delivery_steps] || d.delivery_steps || '–';
      const mfgLabel = d.manufacture_to_resupply
        ? ({ mrp_one_step: 'on (1-step)', pbm: 'on (Pick+MO)', pbm_sam: 'on (Pick+MO+Store)' }[d.manufacture_steps] || 'on')
        : '–';
      const buyLabel = d.buy_to_resupply ? '✓' : '–';
      const resupplyIds = Array.isArray(d.resupply_wh_ids) ? d.resupply_wh_ids : [];
      const resupplyNames = resupplyIds
        .map(id => warehouses.find(w => w.id === id)?.data?.code || id)
        .join(', ') || '–';
      lines.push(`| ${d.code || '–'} | ${wh.label} | ${recvLabel} | ${dlvLabel} | ${mfgLabel} | ${buyLabel} | ${resupplyNames} |`);
    }
    lines.push('');
  }

  // Locations grouped by usage
  const locations = data.nodes.filter(n => n.type === 'location');
  if (locations.length) {
    lines.push('## Locations', '');
    const supplierLocs = locations.filter(l => l.data?.usage === 'supplier');
    const customerLocs = locations.filter(l => l.data?.usage === 'customer');
    const productionLocs = locations.filter(l => l.data?.usage === 'production');
    const otherLocs = locations.filter(l => !['supplier', 'customer', 'production', 'inventory'].includes(l.data?.usage));
    const inventoryLocs = locations.filter(l => l.data?.usage === 'inventory');

    const renderGroup = (label, locs) => {
      if (!locs.length) return;
      lines.push(`### ${label}`, '');
      lines.push('| Name | Usage | Barcode | Removal strategy | Storage cat. | Capacity |');
      lines.push('|------|-------|---------|------------------|--------------|----------|');
      for (const l of locs) {
        const d = l.data || {};
        lines.push(`| ${d.complete_name || l.label} | ${d.usage || '–'} | ${d.barcode || '–'} | ${d.removal_strategy || '–'} | ${d.storage_category_id || '–'} | ${d.capacity || '–'} |`);
      }
      lines.push('');
    };

    renderGroup('Suppliers', supplierLocs);
    renderGroup('Internal', otherLocs);
    renderGroup('Production (virtual)', productionLocs);
    renderGroup('Customers', customerLocs);
    renderGroup('Inventory loss', inventoryLocs);
  }

  // Operation types
  if (data.operationTypes?.length) {
    lines.push('## Operation Types', '');
    lines.push('| Code | Sequence | Name | Type | Source → Destination | Lots |');
    lines.push('|------|----------|------|------|----------------------|------|');
    const locById = new Map(locations.map(l => [l.id, l]));
    const codeMap = { incoming: 'Receipts', outgoing: 'Delivery', internal: 'Internal', mrp_operation: 'Manufacturing' };
    for (const op of data.operationTypes) {
      const src = locById.get(op.src_location_id)?.label || op.src_location_id || '–';
      const dst = locById.get(op.dest_location_id)?.label || op.dest_location_id || '–';
      const lots = op.data?.use_create_lots ? 'Create' : (op.data?.use_existing_lots ? 'Existing' : '–');
      lines.push(`| ${op.sequence_code || op.code || '–'} | – | ${op.label} | ${codeMap[op.code] || op.code || '–'} | ${src} → ${dst} | ${lots} |`);
    }
    lines.push('');
  }

  // Routes & rules
  if (data.routes?.length) {
    lines.push('## Routes & Rules', '');
    const opById = new Map((data.operationTypes || []).map(o => [o.id, o]));
    const locById = new Map(locations.map(l => [l.id, l]));
    for (const r of data.routes) {
      const flags = [];
      if (r.data?.product_selectable) flags.push('product');
      if (r.data?.product_categ_selectable) flags.push('category');
      if (r.data?.warehouse_selectable) flags.push('warehouse');
      if (r.data?.sale_selectable) flags.push('SO');
      const flagSuffix = flags.length ? ` _(${flags.join(', ')})_` : '';
      lines.push(`### ${r.label}${flagSuffix}`, '');
      if (!r.rules?.length) {
        lines.push('_(no rules)_', '');
        continue;
      }
      lines.push('| # | Action | Source → Destination | Op-type | Procure | Auto | Delay | Domain |');
      lines.push('|---|--------|----------------------|---------|---------|------|-------|--------|');
      r.rules.forEach((rl, i) => {
        const src = locById.get(rl.src_location_id)?.label || rl.src_location_id || '–';
        const dst = locById.get(rl.dest_location_id)?.label || rl.dest_location_id || '–';
        const op = opById.get(rl.picking_type_id);
        const opLabel = op ? (op.sequence_code || op.label) : '–';
        const procure = (rl.data?.procure_method || rl.procure_method || '').replace(/_/g, '-');
        const auto = rl.data?.auto || rl.auto || 'manual';
        const delay = rl.data?.delay ?? 0;
        const domain = (rl.data?.domain || '').replace(/\|/g, '\\|') || '–';
        lines.push(`| ${i + 1} | ${rl.action} | ${src} → ${dst} | ${opLabel} | ${procure} | ${auto} | ${delay}d | \`${domain}\` |`);
      });
      lines.push('');
    }
  }

  // Putaway rules grouped by location_in
  if (data.putawayRules?.length) {
    lines.push('## Putaway Rules', '');
    const grouped = new Map();
    for (const pr of data.putawayRules) {
      const key = pr.location_in_id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(pr);
    }
    const locById = new Map(locations.map(l => [l.id, l]));
    for (const [locId, rules] of grouped) {
      const loc = locById.get(locId);
      lines.push(`### ${loc?.label || locId}`, '');
      lines.push('| # | Sequence | Product | Category | → Out location | Strategy | Storage cat. |');
      lines.push('|---|----------|---------|----------|----------------|----------|--------------|');
      const sorted = [...rules].sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99));
      sorted.forEach((pr, i) => {
        lines.push(`| ${i + 1} | ${pr.sequence ?? '–'} | ${pr.product || '–'} | ${pr.category || '–'} | ${pr.location_out || '–'} | ${pr.storage_strategy || 'manual'} | ${pr.storage_category_id || '–'} |`);
      });
      lines.push('');
    }
  }

  // Provenance footer
  const autoGen = data.nodes.filter(n => n.__autoGen).length
    + (data.operationTypes?.filter(o => o.__autoGen).length || 0)
    + (data.routes?.filter(r => r.__autoGen).length || 0);
  if (autoGen) {
    lines.push('---', '');
    lines.push(`_${autoGen} entit${autoGen === 1 ? 'y is' : 'ies are'} wizard-generated (carry \`__autoGen\` provenance tags)._`, '');
  }

  return lines.join('\n');
}
