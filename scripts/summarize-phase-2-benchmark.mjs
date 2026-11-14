// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const groups = ['swarm', 'single-agent', 'external'];
const metrics = ['elapsedMs', 'modelTokens', 'modelCostMicros', 'computeMicrosEstimated', 'computeMicrosReported', 'interventions'];
const configLabels = ['runner', 'runnerVersion', 'model', 'runtime', 'provider', 'providerVersion', 'region', 'plan'];
const configLimits = ['tokenBudget', 'computeBudgetMicros', 'timeoutMs'];
const outcomes = ['completed', 'failed', 'timed-out', 'cancelled'];

function summarize(attempts) {
  const count = (key, value) => attempts.filter(row => row[key] === value).length;
  const completed = count('outcome', 'completed');
  return {
    attempts: attempts.length,
    completed,
    completionRate: completed / attempts.length,
    outcomes: Object.fromEntries(outcomes.map(outcome => [outcome, count('outcome', outcome)])),
    regressions: count('regression', true),
    cleanupFailures: count('cleanup', 'failed'),
    recoveryAttempts: count('recovery', 'succeeded') + count('recovery', 'failed'),
    recoverySuccesses: count('recovery', 'succeeded'),
    measurements: Object.fromEntries(metrics.map(key => {
      const measured = attempts.flatMap(row => row[key] == null ? [] : [row[key]]);
      const total = measured.reduce((sum, value) => sum + value, 0);
      if (!Number.isSafeInteger(total)) throw new Error('Measurement total exceeds safe integer range.');
      return [key, { measured: measured.length, total: measured.length ? total : null,
        mean: measured.length ? total / measured.length : null }];
    })),
  };
}

export function summarizeBenchmark(report) {
  if (typeof report?.revision !== 'string' || !/^[a-f0-9]{40}$/.test(report.revision) || !Array.isArray(report.attempts)) {
    throw new Error('Expected a pinned revision and an attempts array.');
  }
  const configurations = Object.fromEntries(groups.map(group => {
    const config = report.configurations?.[group];
    if (!config || !configLabels.every(key => typeof config[key] === 'string' && config[key].trim()) ||
        !configLimits.every(key => Number.isSafeInteger(config[key]) && config[key] >= 0) || config.timeoutMs === 0) {
      throw new Error('Missing pinned benchmark configuration for ' + group);
    }
    return [group, Object.fromEntries([...configLabels, ...configLimits].map(key => [key, config[key]]))];
  }));
  const ids = new Set();
  const scenarios = new Map();
  for (const row of report.attempts) {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id) ||
        typeof row.scenario !== 'string' || !row.scenario.trim() || !groups.includes(row.group) ||
        !outcomes.includes(row.outcome) || !Number.isSafeInteger(row.elapsedMs) ||
        typeof row.regression !== 'boolean' || !['confirmed', 'failed', 'not-applicable'].includes(row.cleanup) ||
        !['succeeded', 'failed', 'not-attempted'].includes(row.recovery) ||
        metrics.some(key => row[key] != null && (!Number.isSafeInteger(row[key]) || row[key] < 0))) {
      throw new Error('Invalid or duplicate benchmark attempt.');
    }
    ids.add(row.id);
    if (!scenarios.has(row.scenario)) scenarios.set(row.scenario, []);
    scenarios.get(row.scenario).push(row);
  }
  if (!scenarios.size) throw new Error('No benchmark attempts recorded.');
  return { revision: report.revision, configurations, scenarios: Array.from(scenarios, ([scenario, attempts]) => {
    const results = Object.fromEntries(groups.map(group => {
      const rows = attempts.filter(row => row.group === group);
      if (!rows.length) throw new Error('Missing comparison group ' + group + ' for ' + scenario);
      return [group, summarize(rows)];
    }));
    return { scenario, results };
  }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/summarize-phase-2-benchmark.mjs <attempts.json>');
    console.log(JSON.stringify(summarizeBenchmark(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
