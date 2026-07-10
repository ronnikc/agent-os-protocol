// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Boss delegation — a hosted Boss coordinates sub-agents by emitting directive lines. We teach it a
 * strict, easy-to-parse syntax and translate each directive into an action against the named agent.
 * Without this, the Boss can only broadcast prose — which sub-agents ignore (they act only on
 * messages addressed to them) — so it can neither ask an agent for input nor assign it work.
 *
 * Two directive kinds, matching the domain model:
 *   • communication (default) — `@<Agent>: <message>` — the Boss asks an agent for input or
 *     coordinates. This is a plain direct message; NO task is created.
 *   • task — `@<Agent> [task]: <title>` — the Boss assigns a tracked unit of work (e.g. part of a
 *     sprint / phase plan). This creates a real Task in the lobby.
 *
 * Pure and side-effect-free so it is unit-testable independently of the lobby server.
 */

export const BOSS_DELEGATION_GUIDE = [
  '[DELEGATION] To act on a specific agent, put each directive on its OWN line, starting with @ and',
  'the agent\'s exact name from the roster above. Two kinds:',
  '  • Ask for input / coordinate (no task):  `@<Agent Name>: <your question or request>`',
  '  • Assign a tracked task (unit of work):  `@<Agent Name> [task]: <task title>`',
  'Only lines in these exact forms are dispatched — a plain sentence naming an agent is NOT. Use',
  '[task] ONLY for real work worth tracking (e.g. part of a sprint or phase plan); use the plain',
  'form for questions, reviews-of-input, and coordination. Write any human-facing summary as normal',
  'prose on separate lines.',
].join('\n');

export interface BossDirective {
  target: string;
  instruction: string;
  /** 'task' creates a tracked Task; 'message' is a plain coordination/request direct message. */
  kind: 'task' | 'message';
}

/** Extract `@Name: instruction` / `@Name [task]: instruction` directives from a Boss reply. */
export function parseBossDelegations(reply: string): BossDirective[] {
  const out: BossDirective[] = [];
  // group1: agent name (no ':' or '['); group2: optional [task] marker; group3: instruction.
  const re = /^\s*@([^\n:[]+?)\s*(\[task\])?\s*:\s*(\S.*?)\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply)) !== null) {
    const target = m[1].trim();
    const kind: 'task' | 'message' = m[2] ? 'task' : 'message';
    const instruction = m[3].trim();
    if (target && instruction) out.push({ target, instruction, kind });
  }
  return out;
}

export interface RosterAgentLike {
  agent_id: string;
  display_name?: string;
  agent_role?: string;
  status?: string;
}

/** Resolve a directive target name to a connected roster agent (not self, not disconnected). */
export function resolveRosterAgent<T extends RosterAgentLike>(
  roster: T[], target: string, selfId: string,
): T | undefined {
  const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const t = norm(target);
  if (!t) return undefined;
  const candidates = roster.filter(a => a.agent_id !== selfId && a.status !== 'disconnected');
  // Exact match on id / display name / role first, then a startsWith fallback for looser phrasing.
  return candidates.find(a => norm(a.agent_id) === t || norm(a.display_name) === t || norm(a.agent_role) === t)
    ?? candidates.find(a => {
      const dn = norm(a.display_name);
      const role = norm(a.agent_role);
      return (dn.length > 0 && dn.startsWith(t)) || (role.length > 0 && t.startsWith(role));
    });
}
