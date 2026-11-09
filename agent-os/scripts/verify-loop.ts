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
  LOOP_PRESETS,
  continuousQualityLoop,
  createLobbyLoopSeams,
  createSelfLearningReflect,
  taskForCriterion,
  type LoopSeams,
  type CriterionResult,
  type IterationWork,
  type LoopContext,
  type LoopEvent,
  type CheckpointAction,
  type LobbyLoopHost,
  type DispatchedTask,
  type TaskSettlement,
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
  await check('stopping during a checkpoint finishes as killed', async () => {
    const w = makeWorld(1, 0);
    let killed = false;
    const res = await new LoopOrchestrator({
      evaluate: w.evaluate,
      delegate: () => ({ requestedActions: ['commit'] }),
      approveCheckpoint: () => {
        killed = true;
        return false;
      },
      isKilled: () => killed,
    }).run(specFor(w.criteria, { approvalCheckpoints: ['commit'] }));
    assert.equal(res.status, 'killed');
    assert.equal(res.pendingAction, undefined);
    assert.equal(res.iterations, 1);
  });

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

  // ── K2. Reflect seam / self-learning wiring ──
  await check('reflect seam is invoked once per iteration', async () => {
    const w = makeWorld(3, 1);
    const infos: number[] = [];
    const res = await new LoopOrchestrator({
      evaluate: w.evaluate,
      delegate: w.delegate,
      reflect: (_ctx, info) => { infos.push(info.iteration); },
    }).run(specFor(w.criteria));
    assert.equal(res.status, 'converged');
    assert.equal(infos.length, res.iterations, 'one reflect call per iteration');
    assert.deepEqual(infos, infos.slice().sort((a, b) => a - b), 'reflect sees ascending iterations');
  });

  await check('a throwing reflect seam never breaks the loop (best-effort)', async () => {
    const w = makeWorld(2, 1);
    const seen: LoopEvent[] = [];
    const res = await new LoopOrchestrator({
      evaluate: w.evaluate,
      delegate: w.delegate,
      emit: (e) => seen.push(e),
      reflect: () => { throw new Error('boom'); },
    }).run(specFor(w.criteria));
    assert.equal(res.status, 'converged', 'loop still converges despite reflect throwing');
    assert.ok(seen.some((e) => e.type === 'reflected' && e.data?.reflectError === true), 'a reflect failure is recorded, not swallowed silently');
  });

  await check('createSelfLearningReflect skips no-progress iterations by default', async () => {
    const calls: boolean[] = [];
    const reflect = createSelfLearningReflect({ run: (info) => { calls.push(info.progressed); } });
    const ctx = { spec: { goal: 'g' }, iteration: 1, results: [], budgetUsed: {} } as unknown as LoopContext;
    await reflect(ctx, { iteration: 1, progressed: false, noProgress: 1 });
    await reflect(ctx, { iteration: 2, progressed: true, noProgress: 0 });
    assert.deepEqual(calls, [true], 'runs only on the progressing iteration');
  });

  await check('createSelfLearningReflect swallows runner errors (loop-safe)', async () => {
    const reflect = createSelfLearningReflect({ run: () => { throw new Error('nope'); } });
    const ctx = { spec: { goal: 'g' }, iteration: 1, results: [], budgetUsed: {} } as unknown as LoopContext;
    await reflect(ctx, { iteration: 1, progressed: true, noProgress: 0 }); // must not throw
  });

  // ── L. Shipped presets ──
  await check('the continuous-quality preset is a valid, safe LoopSpec', async () => {
    const spec = continuousQualityLoop();
    // a deterministic fix-forward world should converge it through the engine
    const total = spec.exitCriteria.length;
    let fixed = 0;
    const res = await new LoopOrchestrator({
      evaluate: () => spec.exitCriteria.map((c, i) => ({ criterion: c, passed: i < fixed })),
      delegate: () => { fixed += 1; return { tokensUsed: 1 }; },
      approveCheckpoint: () => true,
    }).run(spec, { stallWindow: 10 });
    assert.equal(res.status, 'converged');
    // safety posture: every irreversible action is gated, and it never opens unattended by accident
    for (const a of ['commit', 'merge', 'deploy', 'scope-change']) assert.ok(spec.approvalCheckpoints?.includes(a as CheckpointAction), `${a} must be gated`);
    assert.equal(spec.onConverge, 'open-pr', 'converges to a PR, never an autonomous merge');
    assert.ok((spec.maxIterations ?? 0) > 0 && spec.budget, 'has a hard cap + a budget');
  });

  await check('the preset registry exposes continuous-quality with a tight unattended allowlist', () => {
    const p = LOOP_PRESETS['continuous-quality'];
    assert.ok(p, 'continuous-quality preset registered');
    assert.deepEqual([...p.unattendedAllowlist], ['commit'], 'only commit auto-approves unattended; merge/deploy stay human');
  });

  // ── Section L — Lobby driver (#3): the Boss runs the real orchestrator over a swarm ──
  // A fake lobby host: each dispatched task "fixes" its target criterion (or not), and evaluate
  // reads that mutable world. Proves delegate goes to the swarm while every safety rail still holds.
  function fakeSwarm(opts: { criteria: ExitCriterion[]; roster: string[]; failAssignee?: boolean; noAgent?: boolean }) {
    const fixed = new Set<number>();
    const dispatched: DispatchedTask[] = [];
    const idxOf = (c: ExitCriterion) => opts.criteria.indexOf(c);
    const host: LobbyLoopHost = {
      assigneeFor: (c) => (opts.noAgent ? null : opts.roster[idxOf(c) % opts.roster.length] ?? opts.roster[0] ?? null),
      dispatch: async (task): Promise<TaskSettlement> => {
        dispatched.push(task);
        if (opts.failAssignee) return { status: 'failed', result: 'agent could not fix it', tokensUsed: 5, costUSD: 0.01 };
        fixed.add(idxOf(task.criterion)); // the specialist closed the criterion
        return { status: 'completed', result: 'done', tokensUsed: 10, costUSD: 0.02 };
      },
      evaluateCriterion: (c) => ({ criterion: c, passed: fixed.has(idxOf(c)) }),
    };
    return { host, dispatched, fixed };
  }

  await check('#3 lobby driver: Boss converges by delegating each failing criterion to the swarm', async () => {
    const criteria: ExitCriterion[] = [
      { type: 'gate', skill: 'build-validation' },
      { type: 'tests', mustPass: true },
      { type: 'assertion', expr: 'true' },
    ];
    const { host, dispatched } = fakeSwarm({ criteria, roster: ['agent-be', 'agent-qa', 'agent-fe'] });
    const spec: LoopSpec = { goal: 'green build', exitCriteria: criteria, maxIterations: 5 };
    const res = await new LoopOrchestrator(createLobbyLoopSeams(host)).run(spec);
    assert.equal(res.status, 'converged', 'converges once the swarm closes every criterion');
    assert.equal(res.passing, 3);
    assert.ok(dispatched.length >= 3, 'dispatched a task per failing criterion');
    // Tasks were routed to real roster ids, one per criterion type
    assert.ok(dispatched.some((t) => t.criterion.type === 'tests' && t.category === 'testing'), 'tests → testing task');
    assert.ok(dispatched.every((t) => ['agent-be', 'agent-qa', 'agent-fe'].includes(t.assignedTo)), 'assigned to roster agents');
  });

  await check('#3 lobby driver: budget from swarm settlements accumulates and can exhaust', async () => {
    const criteria: ExitCriterion[] = [{ type: 'gate', skill: 'a' }, { type: 'gate', skill: 'b' }];
    // failAssignee → criteria never close → keeps delegating → token budget trips
    const { host } = fakeSwarm({ criteria, roster: ['x'], failAssignee: true });
    const spec: LoopSpec = { goal: 'g', exitCriteria: criteria, maxIterations: 100, budget: { tokens: 25 } };
    const res = await new LoopOrchestrator(createLobbyLoopSeams(host)).run(spec, { stallWindow: 50 });
    assert.equal(res.status, 'exhausted', 'token budget from settlements halts the loop');
    assert.ok(res.budgetUsed.tokens > 25);
  });

  await check('#3 lobby driver: swarm that cannot fix the gap stalls (anti-churn), never loops forever', async () => {
    const criteria: ExitCriterion[] = [{ type: 'gate', skill: 'a' }];
    const { host } = fakeSwarm({ criteria, roster: ['x'], failAssignee: true });
    const spec: LoopSpec = { goal: 'g', exitCriteria: criteria, maxIterations: 100 };
    const res = await new LoopOrchestrator(createLobbyLoopSeams(host)).run(spec, { stallWindow: 3 });
    assert.equal(res.status, 'stalled');
    assert.ok(res.iterations < 100, 'stopped well before the cap');
  });

  await check('#3 lobby driver: no eligible agent for a criterion is handled, not crashed', async () => {
    const criteria: ExitCriterion[] = [{ type: 'review', approver: 'nobody' }];
    const { host, dispatched } = fakeSwarm({ criteria, roster: [], noAgent: true });
    const spec: LoopSpec = { goal: 'g', exitCriteria: criteria, maxIterations: 3 };
    const res = await new LoopOrchestrator(createLobbyLoopSeams(host)).run(spec, { stallWindow: 2 });
    assert.equal(res.status, 'stalled', 'unassignable criterion → safe stall, no throw');
    assert.equal(dispatched.length, 0, 'nothing dispatched when no agent is eligible');
  });

  await check('#3 lobby driver: checkpoint gating still holds when a swarm task requests an irreversible action', async () => {
    const criteria: ExitCriterion[] = [{ type: 'gate', skill: 'a' }];
    const host: LobbyLoopHost = {
      assigneeFor: () => 'agent-be',
      dispatch: async (task): Promise<TaskSettlement> => ({ status: 'completed', requestedActions: ['commit'], tokensUsed: 1 }),
      evaluateCriterion: (c) => ({ criterion: c, passed: false }), // never converges, so delegate runs
    };
    const spec: LoopSpec = { goal: 'g', exitCriteria: criteria, maxIterations: 3, approvalCheckpoints: ['commit'] };
    // attended (default) + fail-closed approve → the commit checkpoint pauses the loop
    const res = await new LoopOrchestrator(createLobbyLoopSeams(host)).run(spec);
    assert.equal(res.status, 'awaiting_checkpoint');
    assert.equal(res.pendingAction, 'commit', 'the swarm-requested commit is gated by the loop');
  });

  await check('#3 taskForCriterion maps each criterion type to a sensible specialist task', () => {
    assert.match(taskForCriterion({ type: 'tests', mustPass: true }, 'a', 'g', 'high').title, /test suite/i);
    assert.equal(taskForCriterion({ type: 'gate', skill: 'lint' }, 'a', 'g', 'high').title.includes('lint'), true);
    assert.equal(taskForCriterion({ type: 'review', approver: 'qa' }, 'a', 'g', 'high').category, 'code_review');
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
