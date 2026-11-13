// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { summarizeBenchmark } from './summarize-phase-2-benchmark.mjs';

const base = { scenario: 'fixture', outcome: 'completed', elapsedMs: 10,
  regression: false, cleanup: 'confirmed', recovery: 'not-attempted' };
const attempts = [
  { ...base, id: '1', group: 'swarm', modelTokens: 0 },
  { ...base, id: '2', group: 'swarm', outcome: 'failed', elapsedMs: 30,
    regression: true, cleanup: 'failed', recovery: 'succeeded' },
  { ...base, id: '3', group: 'single-agent' },
  { ...base, id: '4', group: 'external' },
];
const report = { revision: 'a'.repeat(40), attempts };
const { swarm } = summarizeBenchmark(report).scenarios[0].results;
assert.equal(swarm.completionRate, 0.5);
assert.equal(swarm.cleanupFailures, 1);
assert.equal(swarm.recoverySuccesses, 1);
assert.equal(swarm.regressions, 1);
assert.deepEqual(swarm.measurements.elapsedMs, { measured: 2, total: 40, mean: 20 });
assert.deepEqual(swarm.measurements.modelTokens, { measured: 1, total: 0, mean: 0 });
assert.deepEqual(swarm.measurements.computeMicrosReported, { measured: 0, total: null, mean: null });
assert.throws(() => summarizeBenchmark({ ...report, attempts: attempts.slice(0, 3) }), /Missing comparison group/);
assert.throws(() => summarizeBenchmark({ ...report, attempts: [...attempts, attempts[0]] }), /duplicate/);
assert.throws(() => summarizeBenchmark({ ...report, revision: 'main' }), /pinned revision/);
console.log('Phase 2 benchmark measurement fixtures passed.');
