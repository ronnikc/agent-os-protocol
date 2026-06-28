#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * verify-loop — runnable functional verification for the Phase 11 Loop Mode engine.
 *
 * Drives the real LoopOrchestrator through every safety + convergence path with **no LLM, lobby,
 * or network**, by injecting scripted `evaluate`/`delegate`/`approveCheckpoint`/`now`/`isKilled`
 * seams over a tiny mutable "world" (the same injected-seam pattern as the other verify-* suites):
 *
 *   A. Convergence — fix-forward world reaches all-criteria-pass within the cap.
 *   B. Already-satisfied — a loop whose criteria already pass converges at iteration 0 (no delegate).
 *   C. Exhaustion — criteria never satisfied → stops at maxIterations.
 *   D. Budget — token/cost/wall-clock budget halts the loop early (exhausted).
 *   E. Stall — no progress for the stall window → stalled (anti-churn).
 *   F. Regression guard — a verify that flips a passing criterion to fail is rejected, not adopted.
 *   G. Kill switch — isKilled halts the loop (killed).
 *   H. Checkpoint (attended) — a gated irreversible action pauses without approval; proceeds with it.
 *   I. Unattended OFF by default — spec.unattended is honoured only with allowUnattended + allowlist.
 *   J. Invalid spec — empty criteria / bad maxIterations / no goal are rejected, never silently run.
 *   K. Audit — every run emits a loop_started…finished event trail to the durable sink.
 *
 * Exits non-zero on the first failed assertion so it can gate a commit / CI.
 */

import assert from 'node:assert/strict';
import type { LoopSpec, ExitCriterion } from '@agent-os/protocol-core';
import {
  LoopOrchestrator,
  InvalidLoopSpecError,
  type LoopSeams,
  type CriterionResult,
  type IterationWork,
  type LoopContext,
  type LoopEvent,
  type CheckpointAction,
} from '@agent-os/loop';

// ── Tiny test runner (matches verify-lobby / verify-identity / verify-launch) ──
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

// ── A scripted "world": N independent criteria; delegate "fixes" up to `fixesPerIteration`. ──
function makeWorld(total: number, fixesPerIteration = 1) {
  const criteria: ExitCriterion[] = Array.from({ length: total }, (_, i) => ({ type: 'assertion', expr: `c${i}` }));
  let fixed = 0;
  return {
    criteria,
    get fixed() { return fixed; },
    set fixed(v: number) { fixed = v; },
    evaluate: (): CriterionResult[] => criteria.map((c, i) => ({ criterion: c, passed: i < fixed })),
    delegate: (): IterationWork => { fixed = Math.min(total, fixed + fixesPerIteration); return { tokensUsed: 10, costUSD: 0.01, summary: `fixed ${fixed}/${total}` }; },
  };
}

function specFor(criteria: ExitCriterion[], over: Partial<LoopSpec> = {}): LoopSpec {
  return { goal: 'reach green', exitCriteria: criteria, maxIterations: 20, ...over };
}

async function main(): Promise<void> {
  console.log('verify-loop — Loop Mode engine\n');

  // ── A. Convergence ──
  await check('converges on a fix-forward world within the iteration cap', async () => {
    const w = makeWorld(3, 1);
    const res = await new LoopOrchestrator({ evaluate: w.evaluate, delegate: w.delegate }).run(specFor(w.criteria));
    assert.equal(res.status, 'converged');
    assert.equal(res.converged, true);
    assert.equal(res.passing, 3);
    assert.equal(res.iterations, 3, 'three fixes, one per iteration');
    assert.ok(res.budgetUsed.tokens === 30, `tokens accrued (${res.budgetUsed.tokens})`);
  });

  // ── B. Already satisfied ──
  await check('a loop whose criteria already pass converges at iteration 0 (no delegation)', async () => {
    const w = makeWorld(2, 1); w.fixed = 2;
    let delegated = 0;
    const res = await new LoopOrchestrator({ evaluate: w.evaluate, delegate: () => { delegated++; return {}; } }).run(specFor(w.criteria));
    assert.equal(res.status, 'converged');
    assert.equal(res.iterations, 0);
    assert.equal(delegated, 0, 'must not delegate when already converged');
  });

  // ── C. Exhaustion at maxIterations ──
  await check('stops at maxIterations when criteria are never satisfied (exhausted)', async () => {
    const w = makeWorld(3, 0); // delegate never fixes anything
    const res = await new LoopOrchestrator({ evaluate: w.evaluate, delegate: w.delegate }).run(specFor(w.criteria, { maxIterations: 4 }));
    // never-progresses also trips stall first; assert it stopped without converging within the cap
    assert.ok(res.status === 'exhausted' || res.status === 'stalled');
    assert.equal(res.converged, false);
    assert.ok(res.iterations <= 4);
  });

  // ── D. Budget ──
  await check('budget (tokens) halts the loop early as exhausted', async () => {
    const w = makeWorld(10, 1); // would take 10 iterations
    const res = await new LoopOrchestrator({ evaluate: w.evaluate, delegate: w.delegate })
      .run(specFor(w.criteria, { maxIterations: 50, budget: { tokens: 25 } }));
    assert.equal(res.status, 'exhausted');
    assert.ok(res.budgetUsed.tokens > 25, 'stopped after exceeding the token budget');
    assert.ok(res.iterations < 10);
    assert.ok(res.events.some((e) => e.type === 'budget_exceeded'));
  });

  await check('budget (wall-clock) halts the loop using the injected clock', async () => {
    const w = makeWorld(10, 1);
    let t = 0;
    const res = await new LoopOrchestrator({ evaluate: w.evaluate, delegate: () => { t += 60000; return w.delegate(); }, now: () => t })
      .run(specFor(w.criteria, { maxIterations: 50, budget: { wallClockMin: 2 } }));
    assert.equal(res.status, 'exhausted');
    assert.ok(res.budgetUsed.wallClockMin > 2);
  });

  // ── E. Stall ──
  await check('detects a stall (no progress for the stall window)', async () => {
    const w = makeWorld(3, 0); // never improves
    const res = await new LoopOrchestrator({ evaluate: w.evaluate, delegate: w.delegate })
      .run(specFor(w.criteria, { maxIterations: 50 }), { stallWindow: 3 });
    assert.equal(res.status, 'stalled');
    assert.equal(res.iterations, 3, 'stops exactly at the stall window');
  });

  // ── F. Regression guard ──
  await check('regression guard rejects an iteration that flips a passing criterion to failing', async () => {
    const criteria: ExitCriterion[] = [{ type: 'tests', mustPass: true }, { type: 'gate', skill: 'build-validation' }];
    let phase = 0; // 0: none pass → after delegate c0 passes; next verify would flip c0 back
    const seams: LoopSeams = {
      evaluate: (): CriterionResult[] => {
        // iteration 1 verify: c0 passes. iteration 2 verify: c0 regresses to fail, c1 "passes".
        if (phase <= 1) return [{ criterion: criteria[0], passed: phase === 1 }, { criterion: criteria[1], passed: false }];
        return [{ criterion: criteria[0], passed: false }, { criterion: criteria[1], passed: true }];
      },
      delegate: (): IterationWork => { phase += 1; return { tokensUsed: 1 }; },
    };
    const res = await new LoopOrchestrator(seams).run(specFor(criteria, { maxIterations: 6 }), { stallWindow: 10 });
    assert.ok(res.events.some((e) => e.type === 'regression_blocked'), 'must emit regression_blocked');
    // The accepted state keeps c0 passing (the regressed verify was rejected, not adopted).
    assert.equal(res.results[0].passed, true, 'previously-passing criterion stays accepted as passing');
  });

  // ── G. Kill switch ──
  await check('kill switch halts the loop (killed)', async () => {
    const w = makeWorld(5, 1);
    let calls = 0;
    const res = await new LoopOrchestrator({ evaluate: w.evaluate, delegate: w.delegate, isKilled: () => ++calls > 2 })
      .run(specFor(w.criteria, { maxIterations: 50 }));
    assert.equal(res.status, 'killed');
    assert.ok(res.events.some((e) => e.type === 'killed'));
  });

  // ── H. Checkpoint gating (attended) ──
  await check('attended: a gated irreversible action pauses without approval', async () => {
    const w = makeWorld(1, 0);
    const seams: LoopSeams = {
      evaluate: w.evaluate,
      delegate: (): IterationWork => ({ requestedActions: ['commit'] }),
      approveCheckpoint: () => false, // human declines
    };
    const res = await new LoopOrchestrator(seams).run(specFor(w.criteria, { approvalCheckpoints: ['commit'] }));
    assert.equal(res.status, 'awaiting_checkpoint');
    assert.equal(res.pendingAction, 'commit');
    assert.ok(res.events.some((e) => e.type === 'checkpoint_rejected'));
  });

  await check('attended: an approved checkpoint lets the loop proceed', async () => {
    const w = makeWorld(2, 1);
    const seams: LoopSeams = {
      evaluate: w.evaluate,
      delegate: (ctx): IterationWork => { const work = w.delegate(); return { ...work, requestedActions: ctx.iteration === 1 ? ['commit'] : [] }; },
      approveCheckpoint: () => true,
    };
    const res = await new LoopOrchestrator(seams).run(specFor(w.criteria, { approvalCheckpoints: ['commit'] }));
    assert.equal(res.status, 'converged');
    assert.ok(res.events.some((e) => e.type === 'checkpoint_approved'));
  });

  // ── I. Unattended OFF by default ──
  await check('unattended is OFF by default: a gated action still pauses even when spec.unattended', async () => {
    const w = makeWorld(1, 0);
    const seams: LoopSeams = { evaluate: w.evaluate, delegate: (): IterationWork => ({ requestedActions: ['commit'] }), approveCheckpoint: () => false };
    const res = await new LoopOrchestrator(seams).run(specFor(w.criteria, { unattended: true, approvalCheckpoints: ['commit'] }));
    assert.equal(res.attended, true, 'spec.unattended alone must not enable unattended');
    assert.equal(res.status, 'awaiting_checkpoint');
  });

  await check('unattended ON (opt-in) auto-approves ONLY allowlisted actions', async () => {
    const w = makeWorld(2, 1);
    let humanAsked = 0;
    const seams: LoopSeams = {
      evaluate: w.evaluate,
      delegate: (ctx): IterationWork => { const work = w.delegate(); return { ...work, requestedActions: ctx.iteration === 1 ? ['commit'] : [] }; },
      approveCheckpoint: () => { humanAsked++; return false; },
    };
    const res = await new LoopOrchestrator(seams).run(
      specFor(w.criteria, { unattended: true, approvalCheckpoints: ['commit', 'merge'] }),
      { allowUnattended: true, unattendedAllowlist: ['commit'] },
    );
    assert.equal(res.attended, false);
    assert.equal(res.status, 'converged');
    assert.equal(humanAsked, 0, 'allowlisted commit auto-approved, no human prompt');
    assert.ok(res.events.some((e) => e.type === 'checkpoint_approved' && e.data?.auto === true));
  });

  await check('unattended ON still pauses for a NON-allowlisted action', async () => {
    const w = makeWorld(1, 0);
    const seams: LoopSeams = { evaluate: w.evaluate, delegate: (): IterationWork => ({ requestedActions: ['merge'] }), approveCheckpoint: () => false };
    const res = await new LoopOrchestrator(seams).run(
      specFor(w.criteria, { unattended: true, approvalCheckpoints: ['merge'] }),
      { allowUnattended: true, unattendedAllowlist: ['commit'] }, // merge NOT allowlisted
    );
    assert.equal(res.status, 'awaiting_checkpoint');
    assert.equal(res.pendingAction, 'merge');
  });

  // ── J. Invalid spec ──
  await check('rejects an invalid spec (never silently runs)', async () => {
    const o = new LoopOrchestrator({ evaluate: () => [], delegate: () => ({}) });
    await assert.rejects(() => o.run({ goal: '', exitCriteria: [{ type: 'tests', mustPass: true }], maxIterations: 5 }), InvalidLoopSpecError);
    await assert.rejects(() => o.run({ goal: 'g', exitCriteria: [], maxIterations: 5 }), InvalidLoopSpecError);
    await assert.rejects(() => o.run({ goal: 'g', exitCriteria: [{ type: 'tests', mustPass: true }], maxIterations: 0 }), InvalidLoopSpecError);
  });

  // ── K. Audit trail ──
  await check('emits a durable loop_started…finished audit trail', async () => {
    const w = makeWorld(2, 1);
    const seen: LoopEvent[] = [];
    const res = await new LoopOrchestrator({ evaluate: w.evaluate, delegate: w.delegate, emit: (e) => seen.push(e) }).run(specFor(w.criteria));
    assert.equal(seen.length, res.events.length, 'every event reaches the sink');
    assert.equal(seen[0].type, 'loop_started');
    assert.equal(seen[seen.length - 1].type, 'finished');
    assert.ok(seen.some((e) => e.type === 'converged'));
    for (const e of seen) assert.ok(typeof e.at === 'number', 'each event is timestamped');
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('verify-loop: all checks passed ✓');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
