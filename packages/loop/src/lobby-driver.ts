// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Lobby loop driver (review finding #3).
 *
 * The `LoopOrchestrator` gives Boss orchestration its safety rails — hard iteration cap, budget,
 * stall detection, regression guard, human checkpoints, kill switch. But until now nothing drove
 * that controller through the *lobby*: the Panel's loop delegated to a single LOCAL agent, and the
 * Boss's lobby delegation (TASK_CREATE blocks) was a separate ad-hoc path with none of those rails.
 *
 * This module bridges the two. It produces the orchestrator's injected `evaluate`/`delegate` seams
 * from a `LobbyLoopHost`, so the Boss can run Assess → **Delegate-to-the-swarm** → Verify → Reflect
 * → Decide: each iteration dispatches a real lobby task per failing exit criterion to a chosen
 * specialist, awaits its settlement, and lets the orchestrator re-verify and apply every safety
 * rule unchanged. The host is a thin seam (three methods) so the whole path stays verifiable in
 * Node with a fake lobby — no LLM, agents, or network — exactly like the rest of the loop engine.
 */

import type { ExitCriterion } from '@agent-os/protocol-core';
import type { LoopContext, LoopSeams, IterationWork, CriterionResult, CheckpointAction } from './orchestrator.js';

/** A task the Boss dispatches to a lobby specialist to close one failing exit criterion. */
export interface DispatchedTask {
  assignedTo: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  category: string;
  /** The exit criterion this task is meant to satisfy (for correlation/telemetry). */
  criterion: ExitCriterion;
}

/** Terminal outcome of a dispatched task, reported back by the lobby. */
export interface TaskSettlement {
  status: 'completed' | 'failed';
  result?: string;
  tokensUsed?: number;
  costUSD?: number;
  /** Irreversible actions the agent's work wants to take — gated by the loop's approvalCheckpoints. */
  requestedActions?: CheckpointAction[];
}

/**
 * The lobby-facing seam the driver needs. A real implementation wraps the relay bridge / lobby
 * client; a test implementation is a plain object — both satisfy the same three methods.
 */
export interface LobbyLoopHost {
  /** Choose the connected agent best suited to a failing criterion, or null if none is available. */
  assigneeFor(criterion: ExitCriterion): string | null;
  /** Dispatch a task to the lobby board and resolve when it settles (completed/failed). */
  dispatch(task: DispatchedTask): Promise<TaskSettlement>;
  /** Evaluate one exit criterion against the current work-item state (gate skill / tests / review). */
  evaluateCriterion(criterion: ExitCriterion): Promise<CriterionResult> | CriterionResult;
}

export interface LobbyDriverOptions {
  /** Priority assigned to dispatched tasks. Default 'high'. */
  priority?: DispatchedTask['priority'];
}

/** Human-readable title/description/category for the task that closes a given criterion. */
export function taskForCriterion(
  criterion: ExitCriterion,
  assignedTo: string,
  goal: string,
  priority: DispatchedTask['priority'],
): DispatchedTask {
  let title: string;
  let category: string;
  switch (criterion.type) {
    case 'gate':
      title = `Fix "${criterion.skill}" gate failures`;
      category = 'general';
      break;
    case 'tests':
      title = 'Make the test suite pass';
      category = 'testing';
      break;
    case 'assertion':
      title = `Satisfy assertion: ${criterion.expr.slice(0, 60)}`;
      category = 'general';
      break;
    case 'review':
      title = `Address review from ${criterion.approver}`;
      category = 'code_review';
      break;
  }
  const description =
    `Loop goal: ${goal}\n\n` +
    `Close this exit criterion so it passes on the next verification:\n` +
    `${JSON.stringify(criterion)}\n\n` +
    `Do the work in the repository directly and report your result. Do not send chat status updates.`;
  return { assignedTo, title, description, priority, category, criterion };
}

/**
 * Build the orchestrator's `evaluate` + `delegate` seams from a lobby host. Pass the result into a
 * `LoopOrchestrator` (spreading in `emit`/`now`/`approveCheckpoint`/`isKilled` as usual) and the
 * Boss loop runs over the swarm with all safety rails intact.
 */
export function createLobbyLoopSeams(
  host: LobbyLoopHost,
  options: LobbyDriverOptions = {},
): Pick<LoopSeams, 'evaluate' | 'delegate'> {
  const priority = options.priority ?? 'high';

  return {
    evaluate: async (ctx: LoopContext): Promise<CriterionResult[]> => {
      // Verify every criterion against the real work-item state — the swarm's tasks are the
      // MECHANISM of change; the gates are the source of truth for convergence.
      const results: CriterionResult[] = [];
      for (const criterion of ctx.spec.exitCriteria) {
        results.push(await host.evaluateCriterion(criterion));
      }
      return results;
    },

    delegate: async (ctx: LoopContext, gap: ExitCriterion[]): Promise<IterationWork> => {
      const parts: string[] = [];
      const requestedActions = new Set<CheckpointAction>();
      let tokensUsed = 0;
      let costUSD = 0;

      // One task per failing criterion, dispatched to the chosen specialist, awaited in turn.
      for (const criterion of gap) {
        const assignee = host.assigneeFor(criterion);
        if (!assignee) {
          parts.push(`${criterion.type}: no eligible agent`);
          continue;
        }
        const task = taskForCriterion(criterion, assignee, ctx.spec.goal, priority);
        const settlement = await host.dispatch(task);
        tokensUsed += settlement.tokensUsed ?? 0;
        costUSD += settlement.costUSD ?? 0;
        for (const a of settlement.requestedActions ?? []) requestedActions.add(a);
        parts.push(`${criterion.type}→${assignee}: ${settlement.status}`);
      }

      return {
        tokensUsed,
        costUSD,
        summary: parts.join('; ') || 'no gap to delegate',
        requestedActions: [...requestedActions],
      };
    },
  };
}
