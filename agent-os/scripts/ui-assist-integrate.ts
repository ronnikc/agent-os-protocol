#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * ui-assist-integrate — the Integration Agent's entry point. Inspects a target project, detects its
 * framework, and prints a ready-to-apply UI Assist integration plan (embed snippet + install checks
 * + secure-connect summary). It only *reads* and *prints* — it never edits the target project (the
 * developer applies the snippet), honouring the Phase 9 safety boundary.
 *
 * Usage:
 *   npm run ui-assist-integrate -- [targetDir] [--relay ws://localhost:4722] [--lobby <url>]
 *                                    [--embed-src /agent-os/ui-assist/embed.js] [--json]
 *
 * The detection/plan logic lives in @agent-os/ui-assist-core (verified by verify-ui-assist); this
 * script just supplies the real-project inventory.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { planIntegration, type ProjectInventory } from '@agent-os/ui-assist-core';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'vendor', '.next', '.svelte-kit', 'coverage']);
const MAX_FILES = 4000;
const MAX_DEPTH = 6;

function walk(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (found.length >= MAX_FILES) return;
      const full = join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        if (SKIP_DIRS.has(name)) {
          found.push(relative(root, full).replace(/\\/g, '/') + '/'); // keep the dir marker (e.g. wp-content/)
          continue;
        }
        visit(full, depth + 1);
      } else {
        found.push(relative(root, full).replace(/\\/g, '/'));
      }
    }
  };
  visit(root, 0);
  return found;
}

function readJsonNames(path: string, keys: string[]): string[] {
  try {
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const names: string[] = [];
    for (const k of keys) {
      const obj = json[k];
      if (obj && typeof obj === 'object') names.push(...Object.keys(obj as Record<string, unknown>));
    }
    return names;
  } catch {
    return [];
  }
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const positional = process.argv.slice(2).find((a) => !a.startsWith('--') && a !== arg('--relay') && a !== arg('--lobby') && a !== arg('--embed-src'));
  const targetDir = positional ?? process.cwd();
  if (!existsSync(targetDir)) {
    console.error(`ui-assist-integrate: target not found: ${targetDir}`);
    process.exit(1);
  }

  const inv: ProjectInventory = {
    files: walk(targetDir),
    dependencies: readJsonNames(join(targetDir, 'package.json'), ['dependencies', 'devDependencies']),
    composer: readJsonNames(join(targetDir, 'composer.json'), ['require', 'require-dev']),
  };

  const { detection, plan } = planIntegration(inv, {
    relayUrl: arg('--relay'),
    lobbyUrl: arg('--lobby'),
    embedSrc: arg('--embed-src'),
  });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ detection, plan }, null, 2));
    return;
  }

  console.log(`\nUI Assist — integration plan for ${targetDir}\n`);
  console.log(`Detected: ${plan.displayName}  (${detection.confidence} confidence)`);
  for (const s of detection.signals) console.log(`  • ${s}`);

  console.log(`\nSteps:`);
  plan.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

  for (const snip of plan.snippets) {
    console.log(`\n— ${snip.label}  (${snip.language}) —`);
    console.log(snip.code);
  }

  console.log(`\nChecks:`);
  for (const c of plan.checks) console.log(`  ☐ ${c}`);

  console.log(`\nConnect: ${plan.connect.relayUrl}${plan.connect.lobbyUrl ? `  (lobby: ${plan.connect.lobbyUrl})` : ''}`);
  for (const n of plan.connect.notes) console.log(`  • ${n}`);
  console.log('');
}

main();
