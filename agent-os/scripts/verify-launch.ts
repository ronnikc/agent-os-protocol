#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * verify-launch — runnable launch-readiness verification for Phase 10.
 *
 * The other five suites prove individual layers; this one proves the repo is *shippable* as a
 * coherent whole, with no network/runtime/key. It asserts the launch invariants a fresh clone
 * depends on:
 *
 *   A. Docs — the launch guide set + capability READMEs are present and non-empty.
 *   B. Entry files — README/LICENSE/NOTICE/.env.example/CLAUDE/plan/package.json present.
 *   C. package.json — run + verify scripts wired; Apache-2.0; valid semver version.
 *   D. Verify scripts — all five layer suites + this one exist on disk.
 *   E. Brand gate — no origin brand tokens in the shipped surface (the 3 fork-describing
 *      docs are the only allowed home for historical references).
 *   F. Domain gate — no origin domain tokens (word-boundary) over the shipped surface.
 *   G. Skill references — every skill an agent definition cites exists on disk (no dangling refs).
 *   H. License — LICENSE is the Apache-2.0 text; NOTICE attributes the copyright holder.
 *   I. Config — .env.example documents the live variables; the .env loader actually parses
 *      and respects real-env precedence (exercises @agent-os/protocol-core's parseEnv/applyEnv).
 *   J. Smoke — the fresh-clone boot smoke script is present (scripts/smoke.sh).
 *
 * NOTE: the forbidden brand/domain tokens are assembled from fragments at runtime so this file
 * itself never contains a contiguous token — otherwise the human-run grep gates (which scan
 * agent-os/) would flag this very script.
 *
 * Exits non-zero on the first failed assertion so it can gate a commit / CI.
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname, relative } from 'node:path';
import { parseEnv, applyEnv } from '@agent-os/protocol-core';

const REPO_ROOT = resolve(import.meta.dirname ?? __dirname, '../..');
const R = (p: string) => join(REPO_ROOT, p);

// ── Tiny test runner (matches the other verify-* suites) ──
let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}\n    ${(err as Error).message.split('\n').join('\n    ')}`);
  }
}

const read = (p: string) => readFileSync(R(p), 'utf8');
const nonEmpty = (p: string) => existsSync(R(p)) && statSync(R(p)).size > 0;

// ── File tree walker (skips .git / node_modules; text files only) ──
const TEXT_EXT = new Set([
  '.md', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html', '.css',
  '.yaml', '.yml', '.txt', '.sh', '.env', '.example',
]);
function* walk(dir: string): Generator<string> {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}
function textFiles(roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    const abs = R(root);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isFile()) { out.push(abs); continue; }
    for (const f of walk(abs)) {
      const ext = extname(f);
      if (TEXT_EXT.has(ext) || ext === '') {
        try { if (statSync(f).size <= 2_000_000) out.push(f); } catch { /* ignore */ }
      }
    }
  }
  return out;
}

// Forbidden tokens assembled from fragments (see NOTE above) so this file stays gate-clean.
const BRAND_TOKENS = ['Aesir' + 'X', 'Compliance' + 'One', 'compliance' + 'one.demo', 'grc' + '-suite', 'Forse' + 'ti'];
const DOMAIN_TOKENS = ['PD' + 'PL', 'DP' + 'IA', 'DS' + 'AR', 'Viet' + 'nam', 'Dec' + 'ree'];
// The three fork-describing docs are the only sanctioned home for historical origin references.
const FORK_DOCS = new Set(['planning.md', 'MIGRATION.md', 'IMPLEMENTATION-PLAN.md'].map((f) => R(f)));

function scanContains(files: string[], tokens: string[], opts: { wordBoundary?: boolean } = {}): string[] {
  const hits: string[] = [];
  const matchers = tokens.map((t) => ({
    token: t,
    re: opts.wordBoundary
      ? new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      : null,
  }));
  for (const f of files) {
    let content: string;
    try { content = readFileSync(f, 'utf8'); } catch { continue; }
    const lower = content.toLowerCase();
    for (const m of matchers) {
      const found = m.re ? m.re.test(content) : lower.includes(m.token.toLowerCase());
      if (found) hits.push(`${relative(REPO_ROOT, f)} :: ${m.token}`);
    }
  }
  return hits;
}

async function main(): Promise<void> {
  console.log('verify-launch — launch-readiness invariants\n');

  // ── A. Launch documentation set ──
  const launchDocs = [
    'docs/README.md', 'docs/getting-started.md', 'docs/examples.md', 'docs/security.md',
    'docs/lobby-hosting.md', 'docs/training-agents.md',
    'docs/adapters/README.md', 'docs/providers/README.md', 'docs/lobby/README.md',
    'docs/identity/README.md', 'docs/ui-assist/README.md',
  ];
  for (const d of launchDocs) {
    await check(`doc present + non-empty: ${d}`, () => assert.ok(nonEmpty(d), `${d} missing or empty`));
  }

  // ── B. Top-level entry files ──
  for (const f of ['README.md', 'LICENSE', 'NOTICE', '.env.example', 'CLAUDE.md', 'IMPLEMENTATION-PLAN.md', 'package.json']) {
    await check(`entry file present: ${f}`, () => assert.ok(nonEmpty(f), `${f} missing or empty`));
  }

  // ── C. package.json wiring ──
  const pkg = JSON.parse(read('package.json'));
  await check('package.json: license is Apache-2.0', () => assert.equal(pkg.license, 'Apache-2.0'));
  await check('package.json: version is a released semver (not 0.0.0)', () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+(?:[-+].+)?$/, `bad version "${pkg.version}"`);
    assert.notEqual(pkg.version, '0.0.0', 'version must be bumped for a release');
  });
  await check('CHANGELOG.md present and its top version matches package.json', () => {
    assert.ok(nonEmpty('CHANGELOG.md'), 'CHANGELOG.md missing');
    const m = read('CHANGELOG.md').match(/^##\s*\[([0-9]+\.[0-9]+\.[0-9]+[^\]]*)\]/m);
    assert.ok(m, 'no released version heading (## [x.y.z]) in CHANGELOG.md');
    assert.equal(m![1], pkg.version, `CHANGELOG top (${m![1]}) != package.json (${pkg.version})`);
  });
  await check('RELEASING.md present', () => assert.ok(nonEmpty('RELEASING.md'), 'RELEASING.md missing'));
  const requiredScripts = [
    'agent-os-panel', 'relay', 'lobby', 'train', 'work-items', 'ui-assist-integrate',
    'verify-adapters', 'verify-providers', 'verify-lobby', 'verify-identity', 'verify-ui-assist',
    'verify-launch', 'verify-all',
  ];
  for (const s of requiredScripts) {
    await check(`package.json: script "${s}" wired`, () =>
      assert.ok(pkg.scripts && typeof pkg.scripts[s] === 'string', `missing script "${s}"`));
  }

  // ── D. Verify scripts exist on disk ──
  for (const s of ['adapters', 'providers', 'lobby', 'identity', 'ui-assist', 'launch']) {
    await check(`verify script on disk: verify-${s}.ts`, () =>
      assert.ok(nonEmpty(`agent-os/scripts/verify-${s}.ts`), `verify-${s}.ts missing`));
  }

  // ── E. Brand gate (whole repo except the sanctioned fork docs) ──
  await check('brand gate: no origin brand tokens outside the fork-describing docs', () => {
    const files = textFiles(['.']).filter((f) => !FORK_DOCS.has(f));
    const hits = scanContains(files, BRAND_TOKENS);
    assert.equal(hits.length, 0, `brand tokens found:\n      ${hits.join('\n      ')}`);
  });

  // ── F. Domain gate (shipped surface, word-boundary) ──
  await check('domain gate: no origin domain tokens over the shipped surface', () => {
    const files = textFiles(['agent-os', 'agent-os-panel', 'docs', 'packages', 'apps']);
    const hits = scanContains(files, DOMAIN_TOKENS, { wordBoundary: true });
    assert.equal(hits.length, 0, `domain tokens found:\n      ${hits.join('\n      ')}`);
  });

  // ── G. Skill-reference integrity (no dangling skill refs in agent defs) ──
  await check('skill references: every skill cited by an agent definition exists', () => {
    const agentsDir = R('agent-os/sub-agents/agents');
    const skillsDir = R('agent-os/sub-agents/skills');
    const dangling: string[] = [];
    for (const f of readdirSync(agentsDir).filter((n) => n.endsWith('.md'))) {
      const content = readFileSync(join(agentsDir, f), 'utf8');
      for (const m of content.matchAll(/skills\/([a-z0-9-]+)\/SKILL\.md/g)) {
        const slug = m[1];
        if (!existsSync(join(skillsDir, slug))) dangling.push(`${f} -> ${slug}`);
      }
    }
    assert.equal(dangling.length, 0, `dangling skill refs:\n      ${dangling.join('\n      ')}`);
  });

  // ── H. License ──
  await check('LICENSE is the Apache-2.0 text', () => {
    const lic = read('LICENSE');
    assert.ok(/Apache License/i.test(lic) && /Version 2\.0/.test(lic), 'LICENSE is not Apache-2.0');
  });
  await check('NOTICE attributes the copyright holder', () => {
    const notice = read('NOTICE');
    assert.ok(/Gothard\.dk/.test(notice), 'NOTICE missing the copyright holder');
  });

  // ── I. Config: .env.example documents the live variables ──
  await check('.env.example documents the live configuration variables', () => {
    const env = read('.env.example');
    for (const v of [
      'AGENT_OS_LOBBY_URL', 'AGENT_OS_PANEL_PORT', 'AGENT_OS_RELAY_PORT',
      'AGENT_OS_LOBBY_PORT', 'AGENT_OS_CONCORDIUM_INDEXER_URL',
    ]) {
      assert.ok(env.includes(v), `.env.example does not document ${v}`);
    }
  });
  await check('the .env loader parses and respects real-env precedence', () => {
    const pairs = parseEnv('# comment\nexport AGENT_OS_PANEL_PORT=4801\nAGENT_OS_LOBBY_URL="http://x"\nBAD line\n');
    assert.equal(pairs.AGENT_OS_PANEL_PORT, '4801');
    assert.equal(pairs.AGENT_OS_LOBBY_URL, 'http://x');
    assert.ok(!('BAD line' in pairs), 'malformed line should be ignored');
    const target: NodeJS.ProcessEnv = { AGENT_OS_PANEL_PORT: '9999' }; // real env already set
    const applied = applyEnv(pairs, target);
    assert.equal(target.AGENT_OS_PANEL_PORT, '9999', 'real env must win over .env');
    assert.equal(target.AGENT_OS_LOBBY_URL, 'http://x', 'unset var should be applied');
    assert.ok(applied.includes('AGENT_OS_LOBBY_URL') && !applied.includes('AGENT_OS_PANEL_PORT'));
  });

  // ── J. Fresh-clone boot smoke present ──
  await check('fresh-clone boot smoke present: scripts/smoke.sh', () =>
    assert.ok(nonEmpty('scripts/smoke.sh'), 'scripts/smoke.sh missing'));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('verify-launch: all checks passed ✓');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
