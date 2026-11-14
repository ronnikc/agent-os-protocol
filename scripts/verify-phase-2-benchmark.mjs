// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const configurations = Object.fromEntries(['swarm', 'single-agent', 'external'].map(runner => [runner, {
  runner, runnerVersion: 'fixture-1', model: 'fixture-model', runtime: 'fixture-runtime',
  provider: 'fixture-provider', providerVersion: 'fixture-1', region: 'local', plan: 'fixture',
  tokenBudget: 100, computeBudgetMicros: 0, timeoutMs: 1000,
}]));
const report = { revision: 'a'.repeat(40), configurations, attempts };
assert.deepEqual(summarizeBenchmark(report).configurations, configurations);
const withExtraFields = { ...configurations, swarm: { ...configurations.swarm, privateNote: 'fixture only' } };
assert.deepEqual(summarizeBenchmark({ ...report, configurations: withExtraFields }).configurations, configurations);
assert.throws(() => summarizeBenchmark({ ...report, configurations: {} }), /Missing pinned benchmark configuration/);
assert.throws(() => summarizeBenchmark({ ...report, revision: [report.revision] }), /pinned revision/);
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
const directory = mkdtempSync(join(tmpdir(), 'phase-2-benchmark-'));
try {
  const script = fileURLToPath(new URL('./summarize-phase-2-benchmark.mjs', import.meta.url));
  const fixture = join(directory, 'attempts.json');
  writeFileSync(fixture, JSON.stringify(report));
  const run = () => spawnSync(process.execPath, [script, fixture], { encoding: 'utf8' });
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout), summarizeBenchmark(report));
  writeFileSync(fixture, JSON.stringify({ ...report, revision: 'main' }));
  const invalid = run();
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /pinned revision/);
} finally {
  rmSync(join(directory, 'attempts.json'), { force: true });
  rmdirSync(directory);
}
console.log('Phase 2 benchmark measurement fixtures passed.');
