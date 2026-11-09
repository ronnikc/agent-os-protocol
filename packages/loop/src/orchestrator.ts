// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Loop Mode engine (IMPLEMENTATION-PLAN.md §12B).
 *
 * A Boss-driven control loop over a work item: each iteration runs
 * **Assess → Delegate → Verify → Reflect → Decide**, converging only when ALL of a
 * `LoopSpec`'s machine-checkable `exitCriteria` pass, and otherwise stopping safely.
 *
 * The engine is runtime-agnostic and side-effect-free on its own — the two things that touch the
 * outside world are **injected seams**: `evaluate` (run the exit criteria — gate skills / tests /
 * review in real use) and `delegate` (assign work to specialists — a lobby dispatch in real use).
 * That makes the whole controller, including every safety rule, verifiable in Node with no LLM,
 * lobby, or network (see `verify-loop`).
 *
 * Safety (all mandatory for unattended operation):
 *  - hard `maxIterations` cap + token/cost/wall-clock `budget` → halt + report on exhaustion;
 *  - convergence/stall detection → stop after N iterations with no criterion improvement;
 *  - regression guard → never adopt an iteration that flips a previously-passing criterion to fail;
 *  - approval checkpoints → irreversible actions (commit/merge/deploy/scope-change) stay
 *    human-gated by default; unattended runs auto-approve ONLY allowlisted actions;
 *  - unattended OFF by default → a `LoopSpec.unattended` request is honoured only when the caller
 *    explicitly enables it (the Panel's per-loop mode-changer), otherwise the loop runs attended;
 *  - durable audit via `emit` + a `isKilled` kill switch checked every iteration.
 */

import type { LoopSpec, ExitCriterion } from '@agent-os/protocol-core';

/** Irreversible actions that may require human approval. */
export type CheckpointAction = 'commit' | 'merge' | 'deploy' | 'scope-change';

/** The result of evaluating a single exit criterion. */
export interface CriterionResult {
  criterion: ExitCriterion;
  passed: boolean;
  /** Optional numeric score (e.g. coverage %), useful for "progress without a flip" detection. */
  score?: number;
  detail?: string;
}

/** Resource usage + requested actions reported by one delegation. */
export interface IterationWork {
  tokensUsed?: number;
  costUSD?: number;
  summary?: string;
  /** Irreversible actions this work wants to take (gated against `approvalCheckpoints`). */
  requestedActions?: CheckpointAction[];
}

export type LoopStatus =
  | 'converged'
  | 'exhausted' // hit maxIterations or budget
  | 'stalled' // no progress for `stallWindow` iterations
  | 'killed' // kill switch
  | 'awaiting_checkpoint' // paused: an irreversible action was not approved
  | 'error';

export type LoopEventType =
  | 'loop_started'
  | 'assessed'
  | 'iteration_started'
  | 'delegated'
  | 'verified'
  | 'regression_blocked'
  | 'reflected'
  | 'checkpoint_requested'
  | 'checkpoint_approved'
  | 'checkpoint_rejected'
  | 'budget_exceeded'
  | 'killed'
  | 'converged'
  | 'stalled'
  | 'exhausted'
  | 'finished';

export interface LoopEvent {
  type: LoopEventType;
  iteration: number;
  at: number; // ms epoch (from the injected clock)
  /** Count of exit criteria currently passing. */
  passing?: number;
  total?: number;
  message?: string;
  data?: Record<string, unknown>;
}

export interface BudgetUsed {
  tokens: number;
  costUSD: number;
  wallClockMin: number;
}

export interface LoopContext {
  spec: LoopSpec;
  iteration: number;
  /** Latest accepted criterion results. */
  results: CriterionResult[];
  budgetUsed: BudgetUsed;
}

export interface LoopSeams {
  /** Evaluate EVERY exit criterion against the current work-item state. */
  evaluate: (ctx: LoopContext) => Promise<CriterionResult[]> | CriterionResult[];
  /** Delegate work to close the gap (lobby dispatch in real use). Returns resource usage. */
  delegate: (ctx: LoopContext, gap: ExitCriterion[]) => Promise<IterationWork> | IterationWork;
  /** Durable audit sink (every event). */
  emit?: (event: LoopEvent) => void;
  /** Clock in ms. Defaults to Date.now. */
  now?: () => number;
  /** Human approval for an irreversible action. Defaults to DENY (fail-closed). */
  approveCheckpoint?: (ctx: LoopContext, action: CheckpointAction) => Promise<boolean> | boolean;
  /** Kill-switch poll, checked at the top of every iteration. Defaults to never killed. */
  isKilled?: () => boolean;
  /**
   * Self-learning hook, invoked once per iteration at the Reflect phase. This is where the loop
   * feeds what just happened back into the memory system + dependency graph + skills review
   * (see agent-os/scripts/self-learning-review.mjs). Best-effort and non-blocking by contract:
   * the orchestrator awaits it but swallows any error so reflection can never stall or fail a loop.
   */
  reflect?: (ctx: LoopContext, info: ReflectInfo) => Promise<void> | void;
}

export interface ReflectInfo {
  iteration: number;
  /** True when this iteration increased the number of passing criteria. */
  progressed: boolean;
  /** Consecutive no-progress iterations (0 right after progress). */
  noProgress: number;
}

export interface RunOptions {
  /**
   * Honour `LoopSpec.unattended`. OFF by default (Ronni-locked): unless the caller explicitly
   * enables it — representing the Panel's per-loop "unattended" mode-changer — the loop runs
   * attended and every checkpoint is gated.
   */
  allowUnattended?: boolean;
  /** Actions auto-approved when running unattended. Anything not listed still pauses. */
  unattendedAllowlist?: CheckpointAction[];
  /** Consecutive no-progress iterations that count as a stall. Default 3. */
  stallWindow?: number;
}

export interface LoopResult {
  status: LoopStatus;
  iterations: number;
  converged: boolean;
  results: CriterionResult[];
  passing: number;
  total: number;
  budgetUsed: BudgetUsed;
  events: LoopEvent[];
  /** Set when status is awaiting_checkpoint. */
  pendingAction?: CheckpointAction;
  /** Effective attended/unattended mode the run executed in. */
  attended: boolean;
}

/** Thrown when a spec is structurally invalid (caught and surfaced; never silently run). */
export class InvalidLoopSpecError extends Error {}

function countPassing(results: CriterionResult[]): number {
  return results.filter((r) => r.passed).length;
}

/** A regression = a criterion that was passing in `prev` is failing in `next`. */
function hasRegression(prev: CriterionResult[], next: CriterionResult[]): boolean {
  return prev.some((p, i) => p.passed && next[i] && !next[i].passed);
}

function validateSpec(spec: LoopSpec): void {
  if (!spec || typeof spec !== 'object') throw new InvalidLoopSpecError('loop spec is required');
  if (!spec.goal || !spec.goal.trim()) throw new InvalidLoopSpecError('loop.goal is required');
  if (!Array.isArray(spec.exitCriteria) || spec.exitCriteria.length === 0)
    throw new InvalidLoopSpecError('loop.exitCriteria must be non-empty — "until perfection" must be machine-checkable');
  if (!Number.isInteger(spec.maxIterations) || spec.maxIterations <= 0)
    throw new InvalidLoopSpecError('loop.maxIterations must be a positive integer (no infinite loops)');
}

/**
 * Run a Loop Mode controller to convergence or a safe stop. Pure given its seams; deterministic
 * when `now`/`evaluate`/`delegate` are deterministic.
 */
export class LoopOrchestrator {
  constructor(private readonly seams: LoopSeams) {}

  async run(spec: LoopSpec, options: RunOptions = {}): Promise<LoopResult> {
    validateSpec(spec);

    const now = this.seams.now ?? Date.now;
    const emit = this.seams.emit ?? (() => {});
    const isKilled = this.seams.isKilled ?? (() => false);
    const approve = this.seams.approveCheckpoint ?? (() => false); // fail-closed
    const stallWindow = options.stallWindow ?? 3;
    const allowlist = new Set(options.unattendedAllowlist ?? []);

    // Unattended is OFF unless the spec asks AND the caller explicitly enabled it.
    const attended = !(spec.unattended === true && options.allowUnattended === true);

    const startMs = now();
    const budgetUsed: BudgetUsed = { tokens: 0, costUSD: 0, wallClockMin: 0 };
    const events: LoopEvent[] = [];
    const record = (e: Omit<LoopEvent, 'at'>) => {
      const full: LoopEvent = { ...e, at: now() };
      events.push(full);
      emit(full);
    };

    const total = spec.exitCriteria.length;
    const ctx = (): LoopContext => ({ spec, iteration, results, budgetUsed });
    let iteration = 0;
    let results: CriterionResult[] = [];

    record({ type: 'loop_started', iteration, total, message: spec.goal, data: { attended } });

    // Initial assessment (iteration 0): a loop already satisfying its criteria converges immediately.
    results = [...(await this.seams.evaluate(ctx()))];
    record({ type: 'assessed', iteration, passing: countPassing(results), total });

    const refreshWallClock = () => {
      budgetUsed.wallClockMin = (now() - startMs) / 60000;
    };
    const overBudget = (): boolean => {
      refreshWallClock();
      const b = spec.budget;
      if (!b) return false;
      return (
        (b.tokens != null && budgetUsed.tokens > b.tokens) ||
        (b.costUSD != null && budgetUsed.costUSD > b.costUSD) ||
        (b.wallClockMin != null && budgetUsed.wallClockMin > b.wallClockMin)
      );
    };

    const finish = (status: LoopStatus, pendingAction?: CheckpointAction): LoopResult => {
      refreshWallClock();
      const passing = countPassing(results);
      record({ type: 'finished', iteration, passing, total, message: status });
      return { status, iterations: iteration, converged: status === 'converged', results, passing, total, budgetUsed, events, pendingAction, attended };
    };

    const finishKilled = (): LoopResult => {
      record({ type: 'killed', iteration });
      return finish('killed');
    };

    if (isKilled()) return finishKilled();
    if (countPassing(results) === total) {
      record({ type: 'converged', iteration, passing: total, total });
      return finish('converged');
    }

    let noProgress = 0;

    while (iteration < spec.maxIterations) {
      if (isKilled()) return finishKilled();
      if (overBudget()) {
        record({ type: 'budget_exceeded', iteration, data: { ...budgetUsed } });
        record({ type: 'exhausted', iteration, message: 'budget' });
        return finish('exhausted');
      }

      iteration += 1;
      record({ type: 'iteration_started', iteration, passing: countPassing(results), total });

      // ── Assess: the gap is the set of failing criteria ──
      const gap = results.filter((r) => !r.passed).map((r) => r.criterion);

      // ── Delegate: close the gap ──
      const work = await this.seams.delegate(ctx(), gap);
      budgetUsed.tokens += work.tokensUsed ?? 0;
      budgetUsed.costUSD += work.costUSD ?? 0;
      record({ type: 'delegated', iteration, message: work.summary, data: { tokensUsed: work.tokensUsed ?? 0, costUSD: work.costUSD ?? 0 } });
      if (isKilled()) return finishKilled();

      // ── Checkpoint gating: irreversible actions need approval (unless unattended + allowlisted) ──
      const gated = (work.requestedActions ?? []).filter((a) => (spec.approvalCheckpoints ?? []).includes(a));
      for (const action of gated) {
        const autoOk = !attended && allowlist.has(action);
        if (autoOk) {
          record({ type: 'checkpoint_approved', iteration, message: action, data: { auto: true } });
          continue;
        }
        record({ type: 'checkpoint_requested', iteration, message: action });
        const ok = await approve(ctx(), action);
        if (isKilled()) return finishKilled();
        if (!ok) {
          record({ type: 'checkpoint_rejected', iteration, message: action });
          return finish('awaiting_checkpoint', action);
        }
        record({ type: 'checkpoint_approved', iteration, message: action, data: { auto: false } });
      }

      // ── Verify: re-evaluate every criterion ──
      const verified = [...(await this.seams.evaluate(ctx()))];
      if (isKilled()) return finishKilled();
      record({ type: 'verified', iteration, passing: countPassing(verified), total });

      // ── Regression guard: never adopt a result that flips a passing criterion to failing ──
      let progressed = false;
      if (hasRegression(results, verified)) {
        record({ type: 'regression_blocked', iteration, message: 'a previously-passing criterion would regress; result rejected' });
        noProgress += 1; // rejected work makes no accepted progress
      } else {
        const before = countPassing(results);
        results = verified;
        const after = countPassing(results);
        progressed = after > before;
        noProgress = progressed ? 0 : noProgress + 1;
      }

      // ── Reflect: feed the iteration back into the self-learning system (memories, graph,
      //    skills review). Best-effort — a failure here never stalls or breaks the loop. ──
      if (this.seams.reflect) {
        try {
          await this.seams.reflect(ctx(), { iteration, progressed, noProgress });
        } catch (err) {
          record({ type: 'reflected', iteration, passing: countPassing(results), total, message: `reflect hook failed: ${err instanceof Error ? err.message : String(err)}`, data: { noProgress, reflectError: true } });
        }
      }
      record({ type: 'reflected', iteration, passing: countPassing(results), total, data: { noProgress } });

      // ── Decide ──
      if (countPassing(results) === total) {
        record({ type: 'converged', iteration, passing: total, total });
        return finish('converged');
      }
      if (noProgress >= stallWindow) {
        record({ type: 'stalled', iteration, message: `no progress for ${noProgress} iterations` });
        return finish('stalled');
      }
    }

    record({ type: 'exhausted', iteration, message: 'maxIterations' });
    return finish('exhausted');
  }
}

export interface SelfLearningReflectOptions {
  /**
   * Runs the actual self-learning pass (in the driver this spawns
   * agent-os/scripts/self-learning-review.mjs, which updates diaries + facts, refreshes the
   * dependency graph, and writes a skills-review report). Injected so this package stays
   * runtime-free and unit-testable.
   */
  run: (info: ReflectInfo & { goal: string }) => Promise<void> | void;
  /** Only reflect on iterations that made progress (default true — skip no-op iterations). */
  onlyOnProgress?: boolean;
}

/**
 * Build a Reflect seam that feeds each loop iteration into the self-learning system. Pure: the
 * side-effecting runner is injected. Wire it into LoopSeams.reflect (see agent-os/scripts/loop.ts
 * and the lobby driver). Never throws to the loop — the orchestrator already guards the call, and
 * this factory additionally swallows runner errors so reflection is strictly best-effort.
 */
export function createSelfLearningReflect(
  opts: SelfLearningReflectOptions,
): NonNullable<LoopSeams['reflect']> {
  return async (ctx: LoopContext, info: ReflectInfo) => {
    if (opts.onlyOnProgress !== false && !info.progressed) return;
    try {
      await opts.run({ ...info, goal: ctx.spec.goal });
    } catch {
      /* best-effort — reflection must never affect loop outcome */
    }
  };
}
