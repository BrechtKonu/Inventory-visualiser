// Copyright (c) 2026 Dinsdag BV. All rights reserved.
// Pure-function: transforms canvas data into a Miro-import-ready JSON dump.
// Spec discussion: docs/superpowers/specs/2026-05-08-warehouse-preset-wizard-design.md
// (Miro Q&A list) and CLAUDE.md "Roadmap wave 2" Miro section.
//
// Format choice: this file emits a structured JSON array following Miro's
// REST API v2 item payload shape. Users can either:
//   (a) Run their own script that POSTs each item to /v2/boards/<id>/items
//   (b) Convert to Miro Board JSON via a one-liner adapter
//   (c) Use it as a reference dump for manual board construction
//
// The mapping (per the user's brain-dump):
//   warehouse → frame                       (color: warehouse hue)
//   location  → sticky_note                  (color by usage)
//   operation type → group of stickies       (or skip — see comment)
//   rule (route edge) → connector
//   route → tag (applied to its rules)
//
// We do NOT call Miro's API directly — auth is the user's problem. This is
// purely the file format.

const COLOR_BY_USAGE = {
  supplier:   'light_yellow',
  internal:   'light_blue',
  customer:   'light_pink',
  production: 'light_green',
  transit:    'gray',
  inventory:  'red',
  view:       'white',
};

const ROUTE_HUE_FALLBACK = '#0ea5e9';

export function exportMiroJson(data, opts = {}) {
  const items = [];
  const tags = [];
  const idMap = new Map(); // app id → miro item ref

  const addItem = (it) => {
    items.push(it);
    if (it._appId) idMap.set(it._appId, it);
  };

  // 1. Warehouses → frames
  const warehouses = data.nodes.filter(n => n.type === 'warehouse');
  for (const wh of warehouses) {
    addItem({
      _appId: wh.id,
      type: 'frame',
      data: { title: wh.label, type: 'freeform' },
      position: { x: wh.x, y: wh.y, origin: 'center' },
      geometry: { width: 600, height: 400 },
      style: {},
    });
  }

  // 2. Locations → sticky notes (color by usage)
  const locations = data.nodes.filter(n => n.type === 'location' && !n.data?.location_id);
  for (const loc of locations) {
    addItem({
      _appId: loc.id,
      type: 'sticky_note',
      data: {
        content: loc.label,
        shape: 'rectangle',
      },
      position: { x: loc.x + 80, y: loc.y + 24, origin: 'center' },
      style: { fillColor: COLOR_BY_USAGE[loc.data?.usage] || 'gray' },
    });
  }

  // 3. Routes → tags (one per route, named after the route)
  for (const route of (data.routes || [])) {
    const tagId = `tag-${route.id}`;
    tags.push({
      _appId: route.id,
      id: tagId,
      title: route.label,
      fillColor: ROUTE_HUE_FALLBACK,
    });
  }

  // 4. Rules → connectors (one per rule, tagged with its route)
  for (const route of (data.routes || [])) {
    for (const rule of (route.rules || [])) {
      const startRef = idMap.get(rule.src_location_id);
      const endRef = idMap.get(rule.dest_location_id);
      if (!startRef || !endRef) continue;
      items.push({
        _appId: rule.id,
        type: 'connector',
        startItem: { id: startRef._appId },
        endItem: { id: endRef._appId },
        captions: [{ content: rule.label || rule.action }],
        style: {
          strokeColor: ROUTE_HUE_FALLBACK,
          strokeStyle: rule.action === 'push' ? 'dashed' : 'normal',
          strokeWidth: 2,
        },
        tagIds: [`tag-${route.id}`],
      });
    }
  }

  // 5. Operation types → standalone sticky notes near their src+dst midpoint
  //    Skipped by default (see opts.includeOpTypes). They tend to clutter Miro.
  if (opts.includeOpTypes) {
    for (const op of (data.operationTypes || [])) {
      const src = data.nodes.find(n => n.id === op.src_location_id);
      const dst = data.nodes.find(n => n.id === op.dest_location_id);
      if (!src || !dst) continue;
      const mx = (src.x + dst.x) / 2 + 80;
      const my = (src.y + dst.y) / 2 + 24;
      items.push({
        _appId: op.id,
        type: 'sticky_note',
        data: { content: `${op.label} (${op.sequence_code || op.code})`, shape: 'square' },
        position: { x: mx, y: my, origin: 'center' },
        style: { fillColor: 'light_gray' },
      });
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    title: opts.title || 'Warehouse Setup',
    note: 'Drop into Miro via REST API: POST /v2/boards/<id>/items per `items[]`. Tags via /v2/boards/<id>/tags.',
    tags,
    items,
  };
}
