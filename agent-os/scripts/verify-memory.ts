#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * verify-memory — runnable verification that the Agent OS self-learning system is fully wired
 * for THIS repository: the memory write path, the dependency graph, the git hooks, and the
 * post-merge self-learning review that closes the loop for every finished PR.
 *
 * No LLM / network. Read-only + dry-run: it never mutates committed state.
 *
 *   A. Scripts present — processor, self-learning review, graph, facts, index builders.
 *   B. Routing — fileToAgents maps this repo's real source roots to REAL agent slugs.
 *   C. Git hooks — .husky/post-merge + pre-commit exist, executable, and call the right scripts.
 *   D. Graph — build scans the monorepo's roots (and, when jq is present, produces a non-empty graph).
 *   E. Self-learning review — runs dry over a range and yields agents + a skills-review report.
 */

import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
import { fileToAgents, protoOwners } from './process-spawn-requests.mjs';
import { run as runSelfLearning } from './self-learning-review.mjs';

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failures.push(name); console.log(`  ✗ ${name}\n      ${(err as Error).message}`); }
}
function isExec(path: string): boolean {
  if (process.platform === 'win32') {
    return execFileSync('git', ['ls-files', '--stage', '--', path], { encoding: 'utf8' }).startsWith('100755 ');
  }
  return (statSync(path).mode & 0o111) !== 0;
}
const agentDefExists = (slug: string) => existsSync(join(ROOT, `agent-os/sub-agents/agents/${slug}.md`));

async function main(): Promise<void> {
  console.log('verify-memory — self-learning system wiring\n');

  // ── A. Scripts present ──
  await check('memory + graph + self-learning scripts are present', () => {
    for (const rel of [
      'agent-os/scripts/process-spawn-requests.mjs',
      'agent-os/scripts/self-learning-review.mjs',
      'agent-os/scripts/graph-build.sh',
      'agent-os/scripts/graph-update.sh',
      'agent-os/scripts/facts-append.sh',
      'agent-os/scripts/build-memory-index.sh',
    ]) assert.ok(existsSync(join(ROOT, rel)), `${rel} missing`);
  });

  // ── B. Routing to REAL agents ──
  await check('fileToAgents routes this repo\'s source roots to real agents', () => {
    const cases: [string, string[]][] = [
      ['packages/relay/src/relay-server.ts', ['backend', 'ui-assist-integration']],
      ['packages/lobby-server/src/coordinator.ts', ['backend', 'lobby-architect']],
      ['packages/identity-concordium/src/x.ts', ['identity', 'security']],
      ['apps/lobby-web/app.js', ['frontend', 'lobby-architect']],
      ['agent-os-panel/tabs/agents.js', ['frontend', 'ui-assist']],
    ];
    for (const [path, expected] of cases) {
      assert.deepEqual(fileToAgents(path), expected, `${path} → ${JSON.stringify(fileToAgents(path))}`);
    }
    // A test file routes to the test agent alongside the owner.
    assert.ok(fileToAgents('packages/relay/src/__tests__/a.test.ts').includes('test'), 'test files route to test agent');
  });

  await check('every agent protoOwners can name exists as an agent definition', () => {
    const probes = [
      'packages/relay/x.ts', 'packages/lobby-server/x.ts', 'packages/lobby-client/x.ts',
      'packages/protocol-core/x.ts', 'packages/adapters/x.ts', 'packages/providers/x.ts',
      'packages/identity-concordium/x.ts', 'packages/ui-assist-core/x.ts', 'packages/ui-assist-embed/x.ts',
      'packages/loop/x.ts', 'packages/unknown-pkg/x.ts',
      'apps/lobby-web/x.js', 'apps/website/x.js', 'apps/other/x.js', 'agent-os-panel/x.js',
    ];
    const slugs = new Set<string>();
    for (const p of probes) for (const s of protoOwners(p)) slugs.add(s);
    assert.ok(slugs.size > 0, 'protoOwners produced no slugs');
    for (const s of slugs) assert.ok(agentDefExists(s), `agent def missing for routed slug "${s}"`);
  });

  // ── C. Git hooks ──
  await check('.husky/post-merge is present, executable, and runs the self-learning review', () => {
    const p = join(ROOT, '.husky/post-merge');
    assert.ok(existsSync(p), '.husky/post-merge missing');
    assert.ok(isExec(p), '.husky/post-merge not executable');
    const body = readFileSync(p, 'utf8');
    assert.match(body, /self-learning-review\.mjs/, 'post-merge does not invoke self-learning-review');
    assert.match(body, /process-spawn-requests\.mjs/, 'post-merge does not drain spawn-requests');
  });

  await check('.husky/pre-commit is present, executable, and guards the memory index', () => {
    const p = join(ROOT, '.husky/pre-commit');
    assert.ok(existsSync(p), '.husky/pre-commit missing');
    assert.ok(isExec(p), '.husky/pre-commit not executable');
    assert.match(readFileSync(p, 'utf8'), /memory-index-staleness\.sh/, 'pre-commit does not run the memory-index guard');
  });

  await check('setup-hooks installer exists and package.json wires it', () => {
    assert.ok(existsSync(join(ROOT, 'scripts/setup-hooks.mjs')), 'scripts/setup-hooks.mjs missing');
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts['setup-hooks'], 'package.json missing setup-hooks script');
    assert.ok(pkg.scripts['self-learning-review'], 'package.json missing self-learning-review script');
    assert.match(String(pkg.scripts['verify-all']), /verify-memory/, 'verify-all does not include verify-memory');
  });

  // ── D. Graph ──
  await check('graph-build scans the monorepo source roots (not a stale src/)', () => {
    const body = readFileSync(join(ROOT, 'agent-os/scripts/graph-build.sh'), 'utf8');
    for (const root of ['packages', 'apps', 'agent-os-panel']) {
      assert.match(body, new RegExp(root), `graph-build does not reference ${root}`);
    }
    assert.ok(existsSync(join(ROOT, 'packages')) && existsSync(join(ROOT, 'apps')), 'expected source roots do not exist');
  });

  await check('graph builds a non-empty graph (skipped if jq is unavailable)', () => {
    let hasJq = true;
    try { execSync('command -v jq', { stdio: 'ignore' }); } catch { hasJq = false; }
    if (!hasJq) { console.log('      (jq not installed — structural check only)'); return; }
    const out = join(mkdtempSync(join(tmpdir(), 'graph-')), 'graph.json');
    execSync(`bash agent-os/scripts/graph-build.sh "" "${out}"`, { stdio: 'ignore' });
    const g = JSON.parse(readFileSync(out, 'utf8'));
    assert.ok(Object.keys(g).length > 0, 'graph has no nodes');
  });

  // ── E. Self-learning review (dry-run — writes nothing) ──
  await check('self-learning review runs dry and yields agents + a report', () => {
    // Need at least one prior commit to form a range; skip cleanly on a root commit.
    let hasParent = true;
    try { execSync('git rev-parse --verify HEAD~1', { stdio: 'ignore' }); } catch { hasParent = false; }
    if (!hasParent) { console.log('      (no HEAD~1 — range unavailable, skipped)'); return; }
    const res = runSelfLearning(['--base', 'HEAD~1', '--head', 'HEAD', '--title', 'verify-memory', '--dry-run']) as {
      ok: boolean; empty?: boolean; report?: string; agents?: string[]; recs?: unknown[];
    };
    assert.ok(res.ok, 'review did not return ok');
    if (res.empty) { console.log('      (empty range — no diff to review)'); return; }
    assert.ok(typeof res.report === 'string' && res.report.includes('Self-Learning Review'), 'no review report produced');
    assert.ok(Array.isArray(res.agents), 'no affected-agents list');
    assert.ok(Array.isArray(res.recs), 'no skills-recommendation list');
  });

  await check('the self-learning reviews directory is tracked (.gitkeep) but reports are ignored', () => {
    assert.ok(existsSync(join(ROOT, 'agent-os/self-learning/reviews/.gitkeep')), 'reviews/.gitkeep missing');
    const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    assert.match(gi, /agent-os\/self-learning\/reviews\/\*/, '.gitignore does not ignore review reports');
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.error(`FAILED: ${failures.join(', ')}`); process.exit(1); }
  console.log('verify-memory: all checks passed ✓');
}

main().catch((err) => { console.error(err); process.exit(1); });
