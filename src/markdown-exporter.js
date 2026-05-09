// Copyright (c) 2026 Dinsdag BV. All rights reserved.
// Pure-function: transforms canvas data into a single Markdown document
// laid out as an Odoo setup runbook — sections in dependency order so a
// consultant can follow it top-to-bottom in a fresh Odoo database and
// reproduce the visualiser's state. Each section names the Odoo menu
// path and lists every field needed for the create.

export function exportMarkdown(data, meta = {}) {
  const lines = [];
  const now = new Date().toISOString().slice(0, 10);
  const title = meta.title || 'Warehouse setup runbook';

  const yes = (v) => (v === true ? '✓' : v === false ? '–' : (v ?? '–'));
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const orDash = (v) => (v === undefined || v === null || v === '') ? '–' : v;

  const companies = data.companies || [];
  const companyById = new Map(companies.map(c => [c.id, c]));
  const compName = (cid) => cid ? (companyById.get(cid)?.name || cid) : '–';

  const cats = data.storageCategories || [];
  const catById = new Map(cats.map(c => [c.id, c]));
  const catName = (cid) => cid ? (catById.get(cid)?.name || cid) : '–';

  const locations = (data.nodes || []).filter(n => n.type === 'location');
  const locById = new Map(locations.map(l => [l.id, l]));
  const locName = (id) => id ? (locById.get(id)?.data?.complete_name || locById.get(id)?.label || id) : '–';

  const warehouses = (data.nodes || []).filter(n => n.type === 'warehouse');
  const whById = new Map(warehouses.map(w => [w.id, w]));
  const whCode = (id) => id ? (whById.get(id)?.data?.code || whById.get(id)?.label || id) : '–';

  const opById = new Map((data.operationTypes || []).map(o => [o.id, o]));
  const opName = (id) => {
    const o = opById.get(id);
    if (!o) return id ? `~${id}` : '–';
    return `${o.label}${o.sequence_code ? ` (${o.sequence_code})` : ''}`;
  };

  // ── Header ──────────────────────────────────────────────────────────────
  lines.push(`# ${title}`, '');
  lines.push(`_Generated ${now} from the Inventory Visualiser._`);
  lines.push('');
  lines.push('Follow the sections **in order** — each step depends on entities created');
  lines.push('in the previous ones. Menu paths refer to a standard Odoo 17/18/19 install with');
  lines.push('the **Inventory** module enabled (and **Manufacturing** for MO routes).');
  lines.push('');
  lines.push('---', '');

  // ── 1. Companies ────────────────────────────────────────────────────────
  if (companies.length > 1) {
    lines.push('## 1. Companies');
    lines.push('_Settings → Users & Companies → Companies_', '');
    lines.push('Create the companies referenced below before any other entity. Most stock entities are scoped per company.', '');
    lines.push('| Code | Name |');
    lines.push('|------|------|');
    for (const c of companies) lines.push(`| ${esc(c.id)} | ${esc(c.name)} |`);
    lines.push('');
  }

  // ── 2. Storage categories ───────────────────────────────────────────────
  if (cats.length) {
    lines.push('## 2. Storage categories');
    lines.push('_Inventory → Configuration → Storage Categories_  ');
    lines.push('_(requires "Storage Categories" feature enabled in Inventory settings)_', '');
    lines.push('Capacity is checked at putaway time. The o2m `capacity_ids` lets you override the default qty per product.', '');
    lines.push('| Name | Allow new product | Max weight (kg) | Default capacity (qty) | Per-product overrides |');
    lines.push('|------|-------------------|-----------------|------------------------|------------------------|');
    for (const c of cats) {
      const overrides = (c.capacity_ids || []).map(r => `${esc(r.product)}: ${r.qty}`).join('; ') || '–';
      lines.push(`| ${esc(c.name)} | ${esc(c.allow_new_product || 'mixed_products')} | ${orDash(c.max_weight)} | ${orDash(c.capacity_qty)} | ${overrides} |`);
    }
    lines.push('');
  }

  // ── 3. Warehouses ───────────────────────────────────────────────────────
  if (warehouses.length) {
    lines.push('## 3. Warehouses');
    lines.push('_Inventory → Configuration → Warehouses_', '');
    lines.push('Creating a warehouse auto-generates its core locations (`<CODE>/Stock`, `Input`, `Output`, etc.) and op-types based on the step counts. Add them first; you will adjust the auto-generated locations + op-types in the next sections.', '');
    lines.push('| Code | Name | Company | Reception | Delivery | Manufacture | Buy | Resupply from |');
    lines.push('|------|------|---------|-----------|----------|-------------|-----|---------------|');
    for (const wh of warehouses) {
      const d = wh.data || {};
      const recv = { one_step: '1-step', two_steps: '2-step (Input → Stock)', three_steps: '3-step (Input → QC → Stock)' }[d.reception_steps] || d.reception_steps || '–';
      const dlv = { ship_only: '1-step', pick_ship: '2-step (Pick → Ship)', pick_pack_ship: '3-step (Pick → Pack → Ship)' }[d.delivery_steps] || d.delivery_steps || '–';
      const mfg = d.manufacture_to_resupply
        ? ({ mrp_one_step: 'on (1-step)', pbm: 'on (Pick + MO)', pbm_sam: 'on (Pick + MO + Store)' }[d.manufacture_steps] || 'on')
        : '–';
      const buy = d.buy_to_resupply ? '✓' : '–';
      const resup = (Array.isArray(d.resupply_wh_ids) ? d.resupply_wh_ids : [])
        .map(id => whCode(id)).join(', ') || '–';
      lines.push(`| ${esc(d.code || '–')} | ${esc(wh.label)} | ${esc(compName(d.company_id))} | ${recv} | ${dlv} | ${mfg} | ${buy} | ${resup} |`);
    }
    lines.push('');
  }

  // ── 4. Locations ────────────────────────────────────────────────────────
  if (locations.length) {
    lines.push('## 4. Locations');
    lines.push('_Inventory → Configuration → Locations_', '');
    lines.push('Create / edit locations top-down: top-level locations first, then sub-locations referencing their `Parent location`. The auto-generated warehouse locations from step 3 are a starting point — adjust them and add the rest.', '');
    lines.push('| Full name | Usage | Parent | Company | Barcode | Removal strategy | Storage category | Capacity (qty / pkg) | Scrap | Return | Replenish |');
    lines.push('|-----------|-------|--------|---------|---------|------------------|------------------|-----------------------|-------|--------|-----------|');
    // Sort: top-level first, then by complete_name so parents precede children
    const sorted = [...locations].sort((a, b) => {
      const ap = a.data?.location_id ? 1 : 0;
      const bp = b.data?.location_id ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return (a.data?.complete_name || a.label || '').localeCompare(b.data?.complete_name || b.label || '');
    });
    for (const l of sorted) {
      const d = l.data || {};
      const cap = (d.capacity_qty || d.capacity_packages)
        ? `${orDash(d.capacity_qty)} / ${orDash(d.capacity_packages)}`
        : (d.capacity ? `${d.capacity} (legacy)` : '–');
      lines.push(`| ${esc(d.complete_name || l.label)} | ${esc(d.usage || 'internal')} | ${esc(d.location_id ? locName(d.location_id) : '–')} | ${esc(compName(d.company_id))} | ${esc(d.barcode || '–')} | ${esc(d.removal_strategy_id || d.removal_strategy || '–')} | ${esc(catName(d.storage_category_id))} | ${cap} | ${yes(d.scrap_location)} | ${yes(d.return_location)} | ${yes(d.replenish_location)} |`);
    }
    lines.push('');
  }

  // ── 5. Operation Types ──────────────────────────────────────────────────
  const ops = data.operationTypes || [];
  if (ops.length) {
    lines.push('## 5. Operation types (`stock.picking.type`)');
    lines.push('_Inventory → Configuration → Operations Types_', '');
    lines.push('Each op-type belongs to a warehouse and references a source + destination location. Adjust the auto-generated ones and add custom ones for crossdock, dropship, internal transfers etc.', '');
    lines.push('| Sequence | Name | Code | Source → Destination | Backorder | Reservation | Lots | Show reserved | Company |');
    lines.push('|----------|------|------|----------------------|-----------|-------------|------|----------------|---------|');
    const codeLabel = { incoming: 'Receipt', outgoing: 'Delivery', internal: 'Internal Transfer', mrp_operation: 'Manufacturing' };
    for (const op of ops) {
      const d = op.data || {};
      const lots = d.use_create_lots ? 'create' : (d.use_existing_lots ? 'existing' : '–');
      lines.push(`| ${esc(op.sequence_code || '–')} | ${esc(d.name || op.label)} | ${codeLabel[op.code] || op.code || '–'} | ${esc(locName(op.src_location_id))} → ${esc(locName(op.dest_location_id))} | ${esc(d.create_backorder || 'ask')} | ${esc(d.reservation_method || 'at_confirm')} | ${lots} | ${yes(d.show_reserved)} | ${esc(compName(d.company_id))} |`);
    }
    lines.push('');
  }

  // ── 6. Routes ───────────────────────────────────────────────────────────
  const routes = data.routes || [];
  if (routes.length) {
    lines.push('## 6. Routes');
    lines.push('_Inventory → Configuration → Routes_', '');
    lines.push('A route is a named bag of stock rules with applicability flags (where it can be selected). Create the route shells first; rules go in step 7.', '');
    lines.push('| Name | Active | Product | Category | Warehouse | SO | Company |');
    lines.push('|------|--------|---------|----------|-----------|----|---------|');
    for (const r of routes) {
      const d = r.data || {};
      lines.push(`| ${esc(d.name || r.label)} | ${yes(d.active !== false)} | ${yes(d.product_selectable)} | ${yes(d.product_categ_selectable)} | ${yes(d.warehouse_selectable)} | ${yes(d.sale_selectable)} | ${esc(compName(d.company_id))} |`);
    }
    lines.push('');
  }

  // ── 7. Stock Rules ──────────────────────────────────────────────────────
  if (routes.length && routes.some(r => r.rules?.length)) {
    lines.push('## 7. Stock rules');
    lines.push('_Inventory → Configuration → Rules_ (or open the route from step 6 and add rules under the **Rules** tab)', '');
    lines.push('Per-route. `action` is the rule\'s mechanism (pull / push / pull+push / buy / manufacture). `procure_method` is `make_to_stock` (MTS) or `make_to_order` (MTO). `domain` filters which `stock.move` records the rule applies to (push rules only).', '');
    for (const r of routes) {
      if (!r.rules?.length) continue;
      lines.push(`### ${r.label}`, '');
      lines.push('| # | Name | Action | Procure | Source → Destination | Op-type | Auto | Delay | Propagate cancel | Domain |');
      lines.push('|---|------|--------|---------|----------------------|---------|------|-------|------------------|--------|');
      r.rules.forEach((rl, i) => {
        const d = rl.data || {};
        const procure = (d.procure_method || rl.procure_method || '').replace(/_/g, '-');
        const auto = d.auto || rl.auto || 'manual';
        const delay = d.delay ?? rl.delay ?? 0;
        const propc = yes(d.propagate_cancel);
        const domain = (d.domain || '').trim() ? `\`${esc(d.domain)}\`` : '–';
        lines.push(`| ${i + 1} | ${esc(d.name || rl.label)} | ${esc(rl.action)} | ${procure} | ${esc(locName(rl.src_location_id))} → ${esc(locName(rl.dest_location_id))} | ${esc(opName(rl.picking_type_id))} | ${auto} | ${delay}d | ${propc} | ${domain} |`);
      });
      lines.push('');
    }
  }

  // ── 8. Putaway Rules ────────────────────────────────────────────────────
  if ((data.putawayRules || []).length) {
    lines.push('## 8. Putaway rules');
    lines.push('_Inventory → Configuration → Putaway Rules_', '');
    lines.push('Resolved at putaway time in `sequence` order (lowest first). Either `Product` or `Category` matches the move; the chosen `Sub-location` becomes the destination override. `Storage strategy` decides between candidate sub-locations when more than one matches.', '');
    const grouped = new Map();
    for (const pr of data.putawayRules) {
      const key = pr.location_in_id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(pr);
    }
    for (const [locId, rules] of grouped) {
      lines.push(`### ${locName(locId)}`, '');
      lines.push('| Seq | Product | Category | → Sub-location | Strategy | Storage category |');
      lines.push('|-----|---------|----------|----------------|----------|------------------|');
      const sorted = [...rules].sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99));
      for (const pr of sorted) {
        const out = pr.location_out_id ? locName(pr.location_out_id) : (pr.location_out || '–');
        lines.push(`| ${orDash(pr.sequence)} | ${esc(pr.product || '–')} | ${esc(pr.category || '–')} | ${esc(out)} | ${esc(pr.storage_strategy || 'manual_no_strategy')} | ${esc(catName(pr.storage_category_id))} |`);
      }
      lines.push('');
    }
  }

  // ── Provenance footer ───────────────────────────────────────────────────
  const autoGen = (data.nodes || []).filter(n => n.__autoGen).length
    + ((data.operationTypes || []).filter(o => o.__autoGen).length)
    + ((data.routes || []).filter(r => r.__autoGen).length);
  lines.push('---', '');
  if (autoGen) {
    lines.push(`_${autoGen} entit${autoGen === 1 ? 'y is' : 'ies are'} wizard-generated (carry \`__autoGen\` provenance tags). Re-running the warehouse-preset wizard with the same flags will recreate them; manual edits on these entities risk being overwritten._`);
  } else {
    lines.push('_No wizard-generated entities — every record above is manual._');
  }
  lines.push('');

  return lines.join('\n');
}
