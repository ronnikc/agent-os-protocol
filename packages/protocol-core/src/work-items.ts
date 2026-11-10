// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * Canonical work-item schema — Phase / Sprint / Task.
 *
 * One schema, one status vocabulary, read and written by every surface (Panel, Gantt,
 * UI Assist, lobby). See IMPLEMENTATION-PLAN.md §12A. The on-disk format is YAML
 * front-matter (phase/sprint) + a single task-checkbox syntax; `parseWorkItems` is the
 * single reader and the authoring skills (create-phase/sprint/task) are the single writers.
 */

/** The single status vocabulary for all work items. */
export type WorkItemStatus = 'planned' | 'in_progress' | 'blocked' | 'complete' | 'cancelled';

export type Priority = 'low' | 'normal' | 'high' | 'critical';

/** A task — the unit of work. Identity is stable and shared across surfaces. */
export interface Task {
  /** Stable unique id (carried in markdown + the tasks store + the lobby). */
  id: string;
  title: string;
  description?: string;
  status: WorkItemStatus;
  priority: Priority;
  /** Agent slug or human assigned to this task. */
  assignee?: string;
  phaseId?: string;
  sprintId?: string;
  /** Ids of tasks this one depends on. */
  dependencies?: string[];
  createdAt: string;
  updatedAt: string;
}

/** A sprint — a bounded set of tasks under a phase. Id is a semver-like `X.Y.Z`. */
export interface Sprint {
  id: string;
  title: string;
  phaseId: string;
  status: WorkItemStatus;
  owner?: string;
  tasks: Task[];
  /** Optional Loop Mode spec (§12B) — present when the sprint runs as a loop. */
  loop?: LoopSpec;
}

/** A phase — a numbered grouping of sprints. Id is `phase-N`. */
export interface Phase {
  id: string;
  name: string;
  status: WorkItemStatus;
  sprints: Sprint[];
}

// ── Loop Mode (§12B) ──

/** A machine-checkable condition for a loop to converge. Reuses the gate skills. */
export type ExitCriterion =
  | { type: 'gate'; skill: string; threshold?: number }
  | { type: 'tests'; mustPass: true }
  | { type: 'review'; approver: string }
  | { type: 'assertion'; expr: string };

/** Loop Mode contract — Boss-driven iterate-until-exit-criteria over a work item. */
export interface LoopSpec {
  goal: string;
  /** ALL must pass for the loop to converge. */
  exitCriteria: ExitCriterion[];
  /** Hard cap — no infinite loops. */
  maxIterations: number;
  budget?: { tokens?: number; wallClockMin?: number; costUSD?: number };
  strategy?: 'fix-forward' | 'tdd' | 'review-driven' | 'custom';
  /** Irreversible actions that stay human-gated. */
  approvalCheckpoints?: ('commit' | 'merge' | 'deploy' | 'scope-change')[];
  /** Unattended swarm loops are OFF by default — explicit opt-in only (Ronni-locked). */
  unattended?: boolean;
  onConverge?: 'stop' | 'handoff' | 'open-pr';
  onExhaust?: 'stop-and-report' | 'escalate-to-human';
}
