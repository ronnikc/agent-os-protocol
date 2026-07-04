#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * loop — run a Loop Mode preset through the engine (npm run loop).
 *
 * This is a **simulated / dry-run driver**: it wires a preset `LoopSpec` to the real
 * `LoopOrchestrator` with deterministic, in-process `evaluate`/`delegate` seams (no live gate
 * skills, no lobby, no LLM) and prints the iteration audit trail. It proves the preset + engine
 * + safety model end-to-end on a fresh clone.
 *
 * Real execution wires `evaluate` to the gate skills and `delegate` to the Boss/lobby via the
 * `loop-orchestrator` skill in a running session; unattended cron execution is scheduler-gated
 * (see docs/loop-mode.md "Deferred").
 *
 *   npm run loop -- --list
 *   npm run loop -- --preset continuous-quality
 *   npm run loop -- --preset continuous-quality --unattended
 *   npm run loop -- --preset continuous-quality --max-iterations 8 --stall-window 4
 */

import {
  LoopOrchestrator,
  LOOP_PRESETS,
  createSelfLearningReflect,
  type CriterionResult,
  type IterationWork,
  type LoopEvent,
  type LoopContext,
  type CheckpointAction,
} from '@agent-os/loop';
import { spawnSync } from 'node:child_process';
import type { LoopSpec } from '@agent-os/protocol-core';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

function usage(): void {
  console.log(`loop — run a Loop Mode preset through the engine (simulated / dry-run)

Usage:
  npm run loop -- --list
  npm run loop -- --preset <name> [--unattended] [--max-iterations N] [--stall-window N]

Presets:`);
  for (const p of Object.values(LOOP_PRESETS)) console.log(`  ${p.name.padEnd(20)} ${p.description}`);
  console.log(`\nThis is a SIMULATION: the spec + engine + safety model run with deterministic seams
(no live gate skills/lobby/LLM). See docs/loop-mode.md for real + unattended execution.`);
}

if (has('--help') || (!has('--preset') && !has('--list')) || (has('--list'))) {
  usage();
  process.exit(0);
}

const presetName = val('--preset')!;
const preset = LOOP_PRESETS[presetName];
if (!preset) {
  console.error(`unknown preset "${presetName}". Run: npm run loop -- --list`);
  process.exit(1);
}

const over: Partial<LoopSpec> = {};
const maxIt = val('--max-iterations');
if (maxIt) over.maxIterations = Number(maxIt);
const spec = preset.build(over);
const unattended = has('--unattended');
const stallWindow = val('--stall-window') ? Number(val('--stall-window')) : undefined;

// ── Deterministic simulated world: each delegate "fixes" one failing criterion. ──
const total = spec.exitCriteria.length;
let fixed = 0;
const evaluate = (): CriterionResult[] => spec.exitCriteria.map((c, i) => ({ criterion: c, passed: i < fixed }));
const delegate = (ctx: LoopContext): IterationWork => {
  fixed = Math.min(total, fixed + 1);
  // Demonstrate the checkpoint path: each iteration "wants" to commit its fix to a branch.
  return { tokensUsed: 250, costUSD: 0.02, summary: `closed 1 gap → ${fixed}/${total}`, requestedActions: ['commit'] as CheckpointAction[] };
};
const approveCheckpoint = (_ctx: LoopContext, action: CheckpointAction): boolean => {
  console.log(`  · checkpoint: ${action} approved (simulated human)`);
  return true;
};

const label = unattended ? 'UNATTENDED (opt-in; allowlist auto-approves)' : 'ATTENDED (checkpoints human-gated)';
console.log(`Loop Mode — simulated run: preset "${preset.name}"  [${label}]`);
console.log(`  goal: ${spec.goal}`);
console.log(`  exit criteria: ${total} · maxIterations: ${spec.maxIterations} · budget: ${JSON.stringify(spec.budget ?? {})}`);
console.log('');

const onEvent = (e: LoopEvent) => {
  if (['iteration_started', 'delegated', 'verified', 'regression_blocked', 'checkpoint_requested', 'converged', 'stalled', 'exhausted', 'killed'].includes(e.type)) {
    const prog = e.passing != null ? ` (${e.passing}/${e.total})` : '';
    console.log(`  [it ${e.iteration}] ${e.type}${prog}${e.message ? ` — ${e.message}` : ''}`);
  }
};

// ── Reflect: feed each progressing iteration into the self-learning system. In this simulation
//    the runner logs the pass; with --self-learning it spawns the real review in --dry-run (safe,
//    no writes) to exercise the full path. Real Boss loops wire host.selfLearn in the lobby driver. ──
const runSelfLearning = has('--self-learning');
const reflect = createSelfLearningReflect({
  run: (info) => {
    console.log(`  [it ${info.iteration}] reflect → self-learning (progressed=${info.progressed})`);
    if (runSelfLearning) {
      spawnSync('node', ['agent-os/scripts/self-learning-review.mjs', '--dry-run'], { stdio: 'inherit' });
    }
  },
});

(async () => {
  const orchestrator = new LoopOrchestrator({ evaluate, delegate, approveCheckpoint, emit: onEvent, reflect });
  const result = await orchestrator.run(spec, {
    allowUnattended: unattended,
    unattendedAllowlist: [...preset.unattendedAllowlist],
    stallWindow,
  });
  console.log('');
  console.log(`Result: ${result.status.toUpperCase()} — ${result.passing}/${result.total} criteria pass after ${result.iterations} iteration(s)`);
  console.log(`  mode: ${result.attended ? 'attended' : 'unattended'} · budget used: ${JSON.stringify(result.budgetUsed)}`);
  if (result.pendingAction) console.log(`  paused awaiting approval for: ${result.pendingAction}`);
  if (result.status === 'converged') console.log(`  onConverge: ${spec.onConverge ?? 'stop'}`);
  process.exit(result.status === 'converged' ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
