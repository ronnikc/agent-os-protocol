#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * work-items — the single writer + reader CLI for the canonical Phase / Sprint / Task schema.
 * Backs the create-phase / create-sprint / create-task authoring skills (§12A).
 *
 *   npx tsx agent-os/scripts/work-items.ts create-phase  --id phase-1 --name "Foundation" [--status planned]
 *   npx tsx agent-os/scripts/work-items.ts create-sprint --phase phase-1 --id 1.0.0 --title "Setup" [--owner planning] [--status planned]
 *   npx tsx agent-os/scripts/work-items.ts create-task   --phase phase-1 --sprint 1.0.0 --title "Do X" [--priority high] [--assignee backend] [--id T-xxxx]
 *   npx tsx agent-os/scripts/work-items.ts parse [--json]
 *   npx tsx agent-os/scripts/work-items.ts validate
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  parseWorkItems,
  serializePhaseReadme,
  serializeSprint,
  serializeTask,
  type Sprint,
  type Task,
  type WorkItemStatus,
} from '@agent-os/protocol-core';

const ROOT = resolve(import.meta.dirname, '../..');
const DIR = join(ROOT, 'agent-os/work-items');
const STATUSES: WorkItemStatus[] = ['planned', 'in_progress', 'blocked', 'complete', 'cancelled'];
const die = (m: string, code = 1): never => { console.error(`work-items: ${m}`); process.exit(code); };

function parseArgs(argv: string[]) {
  const a: Record<string, string | boolean> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) a[t.slice(2)] = true;
      else { a[t.slice(2)] = n; i++; }
    } else pos.push(t);
  }
  return { a, pos };
}

const str = (v: string | boolean | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

function createPhase(a: Record<string, string | boolean>) {
  const id = str(a.id); const name = str(a.name);
  if (!id || !/^phase-\d+$/.test(id)) die('--id must look like phase-N');
  if (!name) die('--name is required');
  const status = (str(a.status) ?? 'planned') as WorkItemStatus;
  if (!STATUSES.includes(status)) die(`--status must be one of ${STATUSES.join('|')}`);
  const dir = join(DIR, id!);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'README.md');
  if (existsSync(path)) die(`phase already exists: ${path}`);
  writeFileSync(path, serializePhaseReadme({ id: id!, name: name!, status }));
  console.log(`created phase ${id} → agent-os/work-items/${id}/README.md`);
}

function createSprint(a: Record<string, string | boolean>) {
  const phase = str(a.phase); const id = str(a.id); const title = str(a.title);
  if (!phase || !/^phase-\d+$/.test(phase)) die('--phase must look like phase-N');
  if (!id || !/^\d+\.\d+\.\d+$/.test(id)) die('--id must be a semver X.Y.Z');
  if (!title) die('--title is required');
  const status = (str(a.status) ?? 'planned') as WorkItemStatus;
  if (!STATUSES.includes(status)) die(`--status must be one of ${STATUSES.join('|')}`);
  const dir = join(DIR, phase!);
  if (!existsSync(dir)) die(`phase ${phase} does not exist — create it first`);
  const path = join(dir, `sprint-${id}.md`);
  if (existsSync(path)) die(`sprint already exists: ${path}`);
  const sprint: Sprint = { id: id!, title: title!, phaseId: phase!, status, owner: str(a.owner), tasks: [] };
  writeFileSync(path, serializeSprint(sprint));
  console.log(`created sprint ${id} → agent-os/work-items/${phase}/sprint-${id}.md`);
}

function createTask(a: Record<string, string | boolean>) {
  const phase = str(a.phase); const sprint = str(a.sprint); const title = str(a.title);
  if (!phase) die('--phase is required');
  if (!sprint) die('--sprint is required (the sprint id X.Y.Z)');
  if (!title) die('--title is required');
  const path = join(DIR, phase!, `sprint-${sprint}.md`);
  if (!existsSync(path)) die(`sprint file not found: ${path}`);
  const id = str(a.id) ?? `T-${randomBytes(3).toString('hex')}`;
  const task: Task = {
    id, title: title!, status: 'planned',
    priority: (str(a.priority) ?? 'normal') as Task['priority'],
    assignee: str(a.assignee), phaseId: phase!, sprintId: sprint!,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const line = serializeTask(task);
  const lines = readFileSync(path, 'utf8').split('\n');
  const tIdx = lines.findIndex((l) => /^##\s+Tasks\b/i.test(l));
  if (tIdx === -1) die(`sprint ${sprint} has no "## Tasks" section`);
  // insert after the last checkbox line in the Tasks section (or right after the heading)
  let ins = tIdx + 1;
  for (let i = tIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    if (/^- \[[ xX]\]/.test(lines[i])) ins = i + 1;
  }
  lines.splice(ins, 0, line);
  writeFileSync(path, lines.join('\n'));
  console.log(`created task ${id} in ${phase}/sprint-${sprint}.md:\n  ${line}`);
}

function validate() {
  const phases = parseWorkItems(DIR);
  const issues: string[] = [];
  for (const p of phases) {
    if (!/^phase-\d+$/.test(p.id)) issues.push(`phase id not canonical: ${p.id}`);
    if (!STATUSES.includes(p.status)) issues.push(`phase ${p.id} bad status: ${p.status}`);
    for (const s of p.sprints) {
      if (!/^\d+\.\d+\.\d+$/.test(s.id)) issues.push(`sprint id not semver: ${s.id}`);
      if (!STATUSES.includes(s.status)) issues.push(`sprint ${s.id} bad status: ${s.status}`);
      for (const t of s.tasks) {
        if (!t.id) issues.push(`task missing id in sprint ${s.id}`);
        if (!STATUSES.includes(t.status)) issues.push(`task ${t.id} bad status: ${t.status}`);
      }
    }
  }
  const total = phases.reduce((n, p) => n + p.sprints.reduce((m, s) => m + s.tasks.length, 0), 0);
  console.log(`validated ${phases.length} phases, ${phases.reduce((n, p) => n + p.sprints.length, 0)} sprints, ${total} tasks`);
  if (issues.length) { issues.forEach((i) => console.error(`  ✗ ${i}`)); process.exit(1); }
  console.log('  ✓ all work items conform to the canonical schema');
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { a } = parseArgs(rest);
  switch (cmd) {
    case 'create-phase': return createPhase(a);
    case 'create-sprint': return createSprint(a);
    case 'create-task': return createTask(a);
    case 'parse': return console.log(JSON.stringify(parseWorkItems(DIR), null, a.json ? 0 : 2));
    case 'validate': return validate();
    default:
      console.log('Usage: work-items <create-phase|create-sprint|create-task|parse|validate> [options]');
      process.exit(cmd ? 1 : 0);
  }
}

main();
