// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Boss delegation — a hosted Boss coordinates sub-agents by emitting directive lines. We teach it a
 * strict, easy-to-parse syntax and translate each directive into a real direct message to the named
 * agent. Without this, the Boss can only broadcast prose — which sub-agents ignore (they act only on
 * messages addressed to them) — so "issue a task to a sub-agent" does nothing.
 *
 * Pure and side-effect-free so it is unit-testable independently of the lobby server.
 */

export const BOSS_DELEGATION_GUIDE = [
  '[DELEGATION] To assign work to a specific agent, put each assignment on its OWN line using EXACTLY',
  'this format: `@<Agent Name>: <what to do>` (start the line with @, then the agent\'s exact name from',
  'the roster above, a colon, then the instruction). Each such line is dispatched to that agent as a',
  'real task — a plain sentence naming an agent is NOT dispatched. Write any human-facing summary as',
  'normal prose on separate lines.',
].join('\n');

/** Extract `@Name: instruction` delegation directives from a Boss reply. */
export function parseBossDelegations(reply: string): Array<{ target: string; instruction: string }> {
  const out: Array<{ target: string; instruction: string }> = [];
  const re = /^\s*@([^\n:]+?)\s*:\s*(\S.*?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply)) !== null) {
    const target = m[1].trim();
    const instruction = m[2].trim();
    if (target && instruction) out.push({ target, instruction });
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
