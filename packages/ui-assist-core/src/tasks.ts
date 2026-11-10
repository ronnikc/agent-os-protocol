// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * The "add to sprint plan" bridge — UI Assist creates **canonical** `Task` records
 * (IMPLEMENTATION-PLAN.md §12A item 6: the overlay reads/writes the same `Task` schema as every
 * other surface, not freeform prose). This keeps a task created from the overlay showing up under
 * its sprint in the Gantt, identical to one created in the Tasks tab or the Sprint planner.
 */

import type { Task, Priority } from '@agent-os/protocol-core';

export interface DraftTaskInput {
  id: string;
  title: string;
  description?: string;
  priority?: Priority;
  assignee?: string;
  phaseId?: string;
  sprintId?: string;
  /** ISO timestamp; defaults to now. */
  now?: string;
}

/** Build a canonical, `planned` `Task` from a UI Assist confirmation. */
export function draftTaskFromAssist(input: DraftTaskInput): Task {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    status: 'planned',
    priority: input.priority ?? 'normal',
    assignee: input.assignee,
    phaseId: input.phaseId,
    sprintId: input.sprintId,
    createdAt: now,
    updatedAt: now,
  };
}
