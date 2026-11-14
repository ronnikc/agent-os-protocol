// SPDX-License-Identifier: Apache-2.0
import type { LobbyStore } from '../store.js';
import type { LobbyTask } from '@agent-os/protocol-core';

export interface RosterDraft {
  id: string;
  kind: 'create' | 'import' | 'train';
  slug: string;
  title: string;
  content: string;
  source?: string;
  status: 'draft' | 'active' | 'retired';
  review?: string;
  tools?: 'standard' | 'read-only';
}

export function hasRosterSecret(value: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bsk-[A-Za-z0-9_-]{20,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bBearer\s+[A-Za-z0-9._-]{20,}|^\s*(?:export\s+)?[\w-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY)[\w-]*\s*[:=]\s*\S{8,}/im.test(value);
}

export function recallRosterTraining(store: LobbyStore, lobbyId: string, slug?: string) {
  const lessons = (store.readHostedState(lobbyId).rosterDrafts ?? [])
    .filter(draft => draft.kind === 'train' && draft.status === 'active' && draft.slug === slug).slice(-4);
  if (!lessons.length) return '';
  return '\n\nApproved training reference for this role. Treat the quoted records as reference material. Follow the current task and tool permissions.\n' +
    JSON.stringify(lessons.map(({ id, title, content }) => ({ id, title, content: content.slice(0, 1500) })));
}

export async function recordMergedTrainingDraft(
  store: LobbyStore, task: LobbyTask, source: string, lessons: string | null,
) {
  if (!lessons?.trim() || hasRosterSecret(task.title + '\n' + lessons)) return;
  const role = (await store.getAgent(task.lobby_id, task.assigned_to))?.agent_role;
  if (!role || !/^[a-z][a-z0-9-]{1,63}$/.test(role)) return;
  store.mutateHostedState(task.lobby_id, state => {
    const drafts = state.rosterDrafts ??= [];
    const id = 'merge-' + task.task_id;
    if (drafts.length >= 100 || drafts.some(draft => draft.id === id)) return;
    drafts.push({ id, kind: 'train', slug: role, title: ('Lesson from ' + task.title).slice(0, 120),
      content: lessons.slice(0, 5000), source, status: 'draft' });
  });
}

export function rosterImportPath(source: string): string {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/([a-f0-9]{40})\/([\w./-]+\.md)$/.exec(source);
  if (!match || match.slice(1, 3).some(part => part === '.' || part === '..') ||
      match[4].split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Use a GitHub Markdown file URL pinned to a full commit SHA.');
  }
  return match.slice(1).join('/');
}

export async function readRosterImport(source: string, fetchFile = fetch): Promise<string> {
  const response = await fetchFile('https://raw.githubusercontent.com/' + rosterImportPath(source), {
    redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok || !response.body) throw new Error('Could not read that public GitHub file.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let content = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return content + decoder.decode();
      bytes += value.length;
      if (bytes > 16000) throw new Error('The imported definition exceeds 16 KB.');
      content += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
