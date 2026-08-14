// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Agent observation — a non-boss hosted agent silently follows the lobby chat (broadcasts from the
 * Boss or a human) and, only when it has a genuinely valuable contribution from its own expertise,
 * "raises a finger" via the Requests system (a `lobby-request` of category `hand_raise`). It never
 * replies conversationally to a broadcast — floor control forbids that — so a raised hand is its one
 * way to surface an idea, risk, or gap for the human/Boss to triage.
 *
 * Pure and side-effect-free so it is unit-testable independently of the lobby server.
 */

export const OBSERVATION_GUIDE = [
  '[OBSERVING] You are silently observing the lobby conversation as a specialist. You do NOT hold the',
  'floor and must not reply conversationally. Consider ONLY whether you have a genuinely valuable,',
  'non-obvious contribution from YOUR expertise — a real risk, a materially better approach, or a',
  'critical gap others are likely to miss. The bar is HIGH: most of the time you have nothing to add.',
  'Respond with EXACTLY ONE of:',
  '  • `PASS` — you have nothing sufficiently valuable to add (this is the common case).',
  '  • `RAISE: <one concise line describing your idea or concern>` — only if it clearly warrants',
  '    human attention. Optionally tag it: `RAISE [risk]: ...` (risk | blocker | clarification | idea).',
  'Output only PASS or the single RAISE line — no preamble, no explanation.',
].join('\n');

export interface HandRaiseIntent {
  /** Short category tag the agent chose (free-form, defaults to "idea"). */
  category: string;
  /** One-line description of the idea/risk. */
  reason: string;
}

/**
 * Parse a hosted agent's observation reply into a hand-raise intent, or null if it passed. Tolerant
 * of formatting: matches a line beginning with RAISE, an optional `[category]` tag, and the reason.
 */
export function parseHandRaise(reply: string): HandRaiseIntent | null {
  if (!reply) return null;
  const line = reply.split(/\r?\n/).map(l => l.trim()).find(l => /^RAISE\b/i.test(l));
  if (!line) return null;
  let rest = line.replace(/^RAISE\b[\s:.\-—–]*/i, '').trim();
  let category = 'idea';
  const tag = rest.match(/^\[([^\]]+)\]\s*[:.\-]?\s*/);
  if (tag) {
    category = tag[1].trim().toLowerCase().replace(/\s+/g, '_') || 'idea';
    rest = rest.slice(tag[0].length).trim();
  }
  if (!rest) return null;
  return { category, reason: rest };
}
