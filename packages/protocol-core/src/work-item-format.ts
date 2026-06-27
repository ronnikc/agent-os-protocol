// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * The single on-disk format for work items, and the single reader/serializer for it.
 * See IMPLEMENTATION-PLAN.md section 12A. Format:
 *
 *   <root>/phase-N/README.md         - YAML front-matter: id, name, status
 *   <root>/phase-N/sprint-X.Y.Z.md   - front-matter: id, title, phase, status, owner
 *                                      plus a "## Tasks" section of checkbox lines:
 *       - [ ] <task-id> <title> (priority:high, assignee:backend, status:planned)
 *       - [x] <task-id> <title> (priority:normal, assignee:test)
 *
 * One reader (parseWorkItems) and one set of serializers - no multi-syntax guessing.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Phase, Sprint, Task, WorkItemStatus, Priority } from './work-items.js';

const STATUSES: WorkItemStatus[] = ['planned', 'in_progress', 'blocked', 'complete', 'cancelled'];
const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'critical'];

const asStatus = (v: string | undefined, fallback: WorkItemStatus): WorkItemStatus =>
  v && (STATUSES as string[]).includes(v) ? (v as WorkItemStatus) : fallback;
const asPriority = (v: string | undefined): Priority =>
  v && (PRIORITIES as string[]).includes(v) ? (v as Priority) : 'normal';

/** Parse the leading front-matter block (flat key: value pairs between --- fences). */
export function parseFrontMatter(content: string): { data: Record<string, string>; body: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: content };
  const data: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, body: m[2] };
}

/** Parse one canonical task checkbox line, or null if it is not one. */
export function parseTaskLine(line: string, phaseId: string, sprintId: string): Task | null {
  const m = line.match(/^- \[([ xX])\]\s+(\S+)\s+(.*?)(?:\s+\(([^)]*)\))?\s*$/);
  if (!m) return null;
  const done = m[1].toLowerCase() === 'x';
  const meta: Record<string, string> = {};
  for (const part of (m[4] ?? '').split(',')) {
    const kv = part.split(':').map((s) => s.trim());
    if (kv.length === 2) meta[kv[0]] = kv[1];
  }
  const now = new Date().toISOString();
  return {
    id: m[2],
    title: m[3].trim(),
    status: done ? 'complete' : asStatus(meta.status, 'planned'),
    priority: asPriority(meta.priority),
    assignee: meta.assignee || undefined,
    phaseId,
    sprintId,
    createdAt: now,
    updatedAt: now,
  };
}

/** Serialize a task to its canonical checkbox line. */
export function serializeTask(task: Task): string {
  const meta: string[] = [`priority:${task.priority}`];
  if (task.assignee) meta.push(`assignee:${task.assignee}`);
  if (task.status !== 'complete' && task.status !== 'planned') meta.push(`status:${task.status}`);
  const check = task.status === 'complete' ? 'x' : ' ';
  return `- [${check}] ${task.id} ${task.title} (${meta.join(', ')})`;
}

/** Serialize a phase README. */
export function serializePhaseReadme(phase: Pick<Phase, 'id' | 'name' | 'status'>): string {
  return `---\nid: ${phase.id}\nname: ${phase.name}\nstatus: ${phase.status}\n---\n\n# ${phase.name}\n`;
}

/** Serialize a sprint file (front-matter plus a Tasks section). */
export function serializeSprint(sprint: Sprint): string {
  const fm = [
    '---',
    `id: ${sprint.id}`,
    `title: ${sprint.title}`,
    `phase: ${sprint.phaseId}`,
    `status: ${sprint.status}`,
    ...(sprint.owner ? [`owner: ${sprint.owner}`] : []),
    '---',
  ].join('\n');
  const tasks = sprint.tasks.map(serializeTask).join('\n');
  return `${fm}\n\n# Sprint ${sprint.id} - ${sprint.title}\n\n## Tasks\n\n${tasks}\n`;
}

/** Parse a single sprint file into a Sprint. */
export function parseSprintFile(content: string, fallbackPhase: string): Sprint {
  const { data, body } = parseFrontMatter(content);
  const id = data.id ?? '0.0.0';
  const phaseId = data.phase ?? fallbackPhase;
  const tasks: Task[] = [];
  let inTasks = false;
  for (const line of body.split('\n')) {
    if (/^##\s+Tasks\b/i.test(line)) { inTasks = true; continue; }
    if (inTasks && /^##\s+/.test(line)) break;
    if (inTasks) {
      const t = parseTaskLine(line, phaseId, id);
      if (t) tasks.push(t);
    }
  }
  return {
    id,
    title: data.title ?? id,
    phaseId,
    status: asStatus(data.status, 'planned'),
    owner: data.owner || undefined,
    tasks,
  };
}

/** The single reader: walk each phase-N directory under root and return the work-item tree. */
export function parseWorkItems(root: string): Phase[] {
  if (!existsSync(root)) return [];
  const phases: Phase[] = [];
  const dirs = readdirSync(root)
    .filter((d) => /^phase-\d+$/.test(d) && statSync(join(root, d)).isDirectory())
    .sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6)));
  for (const dir of dirs) {
    const phaseDir = join(root, dir);
    const readmePath = join(phaseDir, 'README.md');
    const fm = existsSync(readmePath) ? parseFrontMatter(readFileSync(readmePath, 'utf8')).data : {};
    const sprints: Sprint[] = [];
    for (const f of readdirSync(phaseDir).filter((f) => /^sprint-.*\.md$/.test(f)).sort()) {
      sprints.push(parseSprintFile(readFileSync(join(phaseDir, f), 'utf8'), fm.id ?? dir));
    }
    phases.push({
      id: fm.id ?? dir,
      name: fm.name ?? dir,
      status: asStatus(fm.status, 'planned'),
      sprints,
    });
  }
  return phases;
}
