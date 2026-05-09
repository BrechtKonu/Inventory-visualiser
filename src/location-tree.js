// Copyright (c) 2026 Dinsdag BV. All rights reserved.
// Pure-function helpers for the location hierarchy.
// Spec: docs/superpowers/specs/2026-05-09-storage-categories-design.md

// childrenOf(nodes, parentId): direct children of `parentId`.
// parentId === null returns the top-level locations (no location_id set).
export function childrenOf(nodes, parentId) {
  if (parentId === null || parentId === undefined) {
    return nodes.filter(n => n.type === 'location' && !n.data?.location_id);
  }
  return nodes.filter(n => n.type === 'location' && n.data?.location_id === parentId);
}

// descendantsOf(nodes, rootId): all locations under `rootId`, transitive.
// Cycle-safe via visited set; max-depth fallback at 50.
export function descendantsOf(nodes, rootId) {
  const out = [];
  const seen = new Set([rootId]);
  const stack = [{ id: rootId, depth: 0 }];
  while (stack.length) {
    const cur = stack.pop();
    if (cur.depth > 50) continue;
    const kids = childrenOf(nodes, cur.id);
    for (const k of kids) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      out.push(k);
      stack.push({ id: k.id, depth: cur.depth + 1 });
    }
  }
  return out;
}

// ancestorPath(nodes, leafId): ordered list from root → leaf inclusive.
// Cycle-safe; returns the path up to first repeat.
export function ancestorPath(nodes, leafId) {
  const path = [];
  const seen = new Set();
  let cur = nodes.find(n => n.id === leafId);
  let depth = 0;
  while (cur && depth < 50) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    path.unshift(cur);
    const parentId = cur.data?.location_id;
    cur = parentId ? nodes.find(n => n.id === parentId) : null;
    depth++;
  }
  return path;
}

// isDescendantOf: is `candidateId` anywhere under `ancestorId`?
export function isDescendantOf(nodes, candidateId, ancestorId) {
  if (candidateId === ancestorId) return false;
  const path = ancestorPath(nodes, candidateId);
  return path.some(n => n.id === ancestorId);
}

// hasCycle(nodes, leafId): does walking parents from `leafId` revisit a node?
// Cheap detector for the badge-rendering risk listed in the spec.
export function hasCycle(nodes, leafId) {
  const seen = new Set();
  let cur = nodes.find(n => n.id === leafId);
  let depth = 0;
  while (cur && depth < 100) {
    if (seen.has(cur.id)) return true;
    seen.add(cur.id);
    const parentId = cur.data?.location_id;
    cur = parentId ? nodes.find(n => n.id === parentId) : null;
    depth++;
  }
  return depth >= 100;
}
