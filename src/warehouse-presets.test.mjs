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

await flush();
