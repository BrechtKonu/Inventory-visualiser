// Copyright (c) 2026 Dinsdag BV. All rights reserved.
// Pure-function in-browser simulation of Odoo's putaway resolution.
// Spec: docs/superpowers/specs/2026-05-09-storage-categories-design.md
//
// Best-guess preview only. Trust Odoo's actual algorithm for production.

import { childrenOf } from './location-tree.js';

// simulatePutaway(data, ctx) → {
//   matched: rule | null,
//   resolvedLocationId: string | null,
//   capacityCheck: 'ok' | 'over' | 'unknown',
//   currentQty: number | null,
//   capacityQty: number | null,
//   trace: [string, ...],
//   reason: string,
// }
//
// ctx: {
//   product:  string  (free-text product label, matched against rule.product)
//   category: string  (free-text category label, matched against rule.category)
//   location_in_id: string
//   qty: number
// }
//
// Algorithm:
// 1. Filter putaway rules where location_in_id matches.
// 2. Sort by sequence ascending (stable).
// 3. Find first rule whose product/category matches (or wildcard).
// 4. Resolve location_out_id (m2o) preferred; fall back to location_out string.
// 5. Apply storage_strategy to children of the resolved location.
// 6. Capacity check using data._quantsByLocation if present.
export function simulatePutaway(data, ctx) {
  const trace = [];
  const out = {
    matched: null,
    resolvedLocationId: null,
    capacityCheck: 'unknown',
    currentQty: null,
    capacityQty: null,
    trace,
    reason: '',
  };

  const rules = (data.putawayRules || [])
    .filter(r => r.location_in_id === ctx.location_in_id)
    .slice()
    .sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999));
  trace.push(`step 1: ${rules.length} rule(s) at location_in=${ctx.location_in_id}`);

  if (!rules.length) {
    out.reason = 'no putaway rules at this location';
    return out;
  }

  const matchProduct = (rp, ctxp) => {
    if (!rp) return null;        // not specified — neutral
    if (!ctxp) return false;     // rule wants product, ctx doesn't have one
    return rp === ctxp || rp.toLowerCase().includes(ctxp.toLowerCase()) || ctxp.toLowerCase().includes(rp.toLowerCase());
  };
  const matchCategory = (rc, ctxc) => {
    if (!rc || rc === 'All') return null;
    if (!ctxc) return false;
    return rc === ctxc || rc.toLowerCase().includes(ctxc.toLowerCase()) || ctxc.toLowerCase().includes(rc.toLowerCase());
  };

  let matched = null;
  for (const rule of rules) {
    const pm = matchProduct(rule.product, ctx.product);
    const cm = matchCategory(rule.category, ctx.category);
    // Wildcard rule (no product, no category, or category='All') always matches.
    const isWildcard = !rule.product && (!rule.category || rule.category === 'All');
    // Specific match if EITHER product or category explicitly matches; reject if either is explicitly false.
    if (pm === false || cm === false) continue;
    if (isWildcard || pm === true || cm === true) {
      matched = rule;
      trace.push(`step 2: matched rule ${rule.id} (seq=${rule.sequence ?? '–'}, product='${rule.product || '*'}', category='${rule.category || '*'}')`);
      break;
    }
  }

  if (!matched) {
    out.reason = `no rule matched product='${ctx.product}' category='${ctx.category}'`;
    return out;
  }
  out.matched = matched;

  // Resolve target — prefer m2o, fall back to string.
  let targetId = matched.location_out_id || null;
  if (!targetId && matched.location_out) {
    // String fallback — try to find a location whose complete_name matches.
    const found = (data.nodes || []).find(n =>
      n.type === 'location' && n.data?.complete_name === matched.location_out
    );
    targetId = found?.id || null;
    if (targetId) trace.push(`step 3: resolved string '${matched.location_out}' → node ${targetId}`);
    else trace.push(`step 3: string '${matched.location_out}' (phantom — no matching node)`);
  } else if (targetId) {
    trace.push(`step 3: location_out_id = ${targetId}`);
  }

  if (!targetId) {
    out.reason = 'rule matched but resolved target is a phantom (string-only)';
    return out;
  }

  // Apply storage_strategy: pick best child of `targetId` if children exist.
  const strategy = matched.storage_strategy || 'manual_no_strategy';
  const kids = childrenOf(data.nodes || [], targetId);
  let chosenId = targetId;

  if (kids.length > 0) {
    if (strategy === 'closest_location') {
      // Proxy: pick lowest barcode (or label) ASCII-sorted.
      const sorted = kids.slice().sort((a, b) =>
        (a.data?.barcode || a.label || '').localeCompare(b.data?.barcode || b.label || ''));
      chosenId = sorted[0].id;
      trace.push(`step 4: closest_location → ${chosenId} (alphabetic)`);
    } else if (strategy === 'least_packages') {
      // Pick the kid with lowest current_qty / capacity_qty ratio. No quants → fall back to first.
      const quants = data._quantsByLocation || {};
      const ranked = kids.slice().sort((a, b) => {
        const aCur = quants[a.id] ?? 0, aCap = a.data?.capacity_qty || a.data?.capacity || Infinity;
        const bCur = quants[b.id] ?? 0, bCap = b.data?.capacity_qty || b.data?.capacity || Infinity;
        return (aCur / aCap) - (bCur / bCap);
      });
      chosenId = ranked[0].id;
      trace.push(`step 4: least_packages → ${chosenId}`);
    } else {
      trace.push(`step 4: manual_no_strategy → keep ${chosenId}`);
    }
  } else {
    trace.push(`step 4: ${strategy} (target has no sub-locations; using ${chosenId} directly)`);
  }
  out.resolvedLocationId = chosenId;

  // Capacity check.
  const chosenNode = (data.nodes || []).find(n => n.id === chosenId);
  const cap = chosenNode?.data?.capacity_qty || chosenNode?.data?.capacity || null;
  const currentRaw = data._quantsByLocation?.[chosenId];
  const current = currentRaw ?? null;
  if (cap !== null && current !== null) {
    const after = current + (ctx.qty || 0);
    out.capacityQty = cap;
    out.currentQty = current;
    out.capacityCheck = after > cap ? 'over' : 'ok';
    trace.push(`step 5: capacity ${current} + ${ctx.qty} = ${after} / ${cap} → ${out.capacityCheck}`);
    out.reason = out.capacityCheck === 'over'
      ? `would exceed capacity (${after}/${cap})`
      : `will place ${ctx.qty} unit(s); capacity ok (${after}/${cap})`;
  } else {
    out.capacityCheck = 'unknown';
    out.capacityQty = cap;
    out.currentQty = current;
    trace.push(`step 5: capacity ${cap === null ? 'unset' : 'set'}, current ${current === null ? 'unknown (no fetch)' : current}`);
    out.reason = `will place at ${chosenNode?.label || chosenId} (capacity: ${cap === null ? 'no limit' : 'unverified — fetch quants for status'})`;
  }
  return out;
}
