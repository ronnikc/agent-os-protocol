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
  'the agent\'s exact name from the roster above:',
  '  • Ask for input / coordinate (no task):  `@<Agent Name>: <your question or request>`',
  '  • Assign a tracked repository task: `@<Agent Name> [task]: <what to do>`',
  '  • Assign tracked work delivered in text: `@<Agent Name> [task text]: <what to do>`',
  'For dependent work, assign prerequisites first. On each task handoff, inspect the recorded statuses and results.',
  'Assign the next stage once all prerequisites succeeded and that stage has not already been assigned.',
  'On a confirmed merge notice, tell the owner what merged. Only report a merge supported by GitHub status.',
  'Task cards and handoffs already record routine work. Skip acknowledgments and intermediate recaps.',
  'On a handoff, emit only required delegation directives, an actionable blocker, or a final delivery summary.',
  'If no owner update or delegation is needed, reply exactly [NO UPDATE].',
  'Only lines in these exact forms are dispatched — a plain sentence naming an agent is NOT. Use',
  '[task] ONLY for real work worth tracking (e.g. part of a sprint or phase plan); use the plain',
  'form for questions, reviews-of-input, and coordination. Write any human-facing summary as normal',
  'prose on separate lines.',
  'CRITICAL: You yourself have NO tools — you cannot edit repositories, run code, or produce',
  'deliverables. The ONLY way any real work happens is a `[task]` directive to a specialist agent,',
  'who executes it immediately on assignment (assignment IS the ask — do not pre-negotiate an ACK',
  'and never claim you will "proceed" with work yourself). When the owner asks for work, emit the',
  '`[task]` line in THIS reply.',
].join('\n');

export interface BossDirective {
  target: string;
  instruction: string;
  /** 'task' creates a tracked Task; 'message' is a plain coordination/request direct message. */
  kind: 'task' | 'message';
  outputMode?: 'text';
}

/** Extract `@Name: instruction` / `@Name [task]: instruction` directives from a Boss reply. */
export function parseBossDelegations(reply: string): BossDirective[] {
  const out: BossDirective[] = [];
  // group1: agent name (no ':' or '['); group2: optional [task] marker; group3: instruction.
  const re = /^[ \t]*@([^\n:[]+?)[ \t]*(\[task( text)?\])?[ \t]*:[ \t]*(\S.*?)[ \t]*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply)) !== null) {
    const target = m[1].trim();
    const kind: 'task' | 'message' = m[2] ? 'task' : 'message';
    const instruction = m[3].trim();
    if (target && instruction) out.push({ target, instruction, kind, ...(m[3] ? { outputMode: 'text' as const } : {}) });
  }
  return out;
}

// ── Boss request triage ──
// The Boss handles the Requests queue (boss-agent.md "Request Triage"): it DECIDES hand-raises
// itself — they are floor-control coordination ("may I contribute?"), not authority actions — and
// only RECOMMENDS on authority categories (commit approval, merge readiness, scope change, …),
// which stay with the human LobbyOwner ("no autonomous approvals").

export const BOSS_TRIAGE_GUIDE = [
  '[REQUEST TRIAGE] A lobby request needs your triage. Reply with EXACTLY ONE line:',
  '  • `APPROVE: <short note>` — the agent should go ahead / the input is welcome now.',
  '  • `REJECT: <short note>` — not useful or out of scope; the note tells the agent why.',
  '  • `DEFER: <short note>` — valid but not now; the note says when/what would change that.',
  '  • `ESCALATE: <short note>` — you are unsure or it needs the LobbyOwner; it stays pending.',
  'Judge against the roster, open tasks, and current priorities. Output only that one line.',
].join('\n');

export const BOSS_RECOMMEND_GUIDE = [
  '[REQUEST RECOMMENDATION] A request that only the human LobbyOwner may decide needs your',
  'recommendation. Reply with EXACTLY ONE line: `RECOMMEND <approve|reject|defer>: <short reason>`.',
  'Output only that line.',
].join('\n');

/** Parse the Boss's triage verdict. Returns null when it escalated or answered off-format. */
export function parseBossTriage(reply: string): { decision: 'approved' | 'rejected' | 'deferred'; note: string } | null {
  const line = (reply ?? '').split(/\r?\n/).map(l => l.trim()).find(l => /^(APPROVE|REJECT|DEFER|ESCALATE)\b/i.test(l));
  if (!line) return null;
  const m = line.match(/^(APPROVE|REJECT|DEFER)\b[\s:.\-—–]*(.*)$/i);
  if (!m) return null; // ESCALATE (or garbage) — leave pending for the human
  const map: Record<string, 'approved' | 'rejected' | 'deferred'> = { approve: 'approved', reject: 'rejected', defer: 'deferred' };
  return { decision: map[m[1].toLowerCase()], note: m[2].trim() };
}

/** Parse `RECOMMEND <verdict>: reason` from a Boss recommendation turn. */
export function parseBossRecommendation(reply: string): string | null {
  const line = (reply ?? '').split(/\r?\n/).map(l => l.trim()).find(l => /^RECOMMEND\b/i.test(l));
  if (!line) return null;
  const m = line.match(/^RECOMMEND\s+(approve|reject|defer)\b[\s:.\-—–]*(.*)$/i);
  if (!m) return null;
  return `${m[1].toLowerCase()}${m[2].trim() ? ` — ${m[2].trim()}` : ''}`;
}

/** Categories the Boss may DECIDE itself; everything else is human authority (recommend only). */
export const BOSS_DECIDABLE_CATEGORIES = new Set(['hand_raise']);

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
