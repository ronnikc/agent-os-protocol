// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * Response rendering helper — the canonical implementation of UI-ASSIST.md Rule 1: a **trailing**
 * numbered list of **2+ items** at the end of an assistant message is extracted and surfaced as
 * clickable quick-action buttons; everything above it stays as the message body.
 *
 * Pure and DOM-free so it can be unit-verified and reused by any overlay (the repo-local embed
 * inlines an equivalent for the browser; `verify-ui-assist` cross-checks the two agree).
 */

export interface ExtractedActions {
  /** The message body with the trailing action list removed. */
  body: string;
  /** Ordered action labels (empty when there is no qualifying trailing list). */
  actions: string[];
}

const NUMBERED_LINE = /^\s*(\d+)[.)]\s+(.*\S)\s*$/;

/**
 * Split a message into `{ body, actions }`. Only a numbered list flush at the **end** of the
 * message (ignoring trailing blank lines) with **2 or more** items becomes actions; a numbered list
 * in the middle, or a single trailing item, is left untouched in the body.
 */
export function extractTrailingActions(markdown: string): ExtractedActions {
  const lines = markdown.replace(/\s+$/, '').split('\n');

  // Walk up from the bottom collecting a contiguous run of numbered lines.
  let i = lines.length - 1;
  const collected: string[] = [];
  while (i >= 0) {
    const m = lines[i].match(NUMBERED_LINE);
    if (!m) break;
    collected.push(m[2].trim());
    i--;
  }

  // Need 2+ trailing items, and they must be the tail of the message.
  if (collected.length < 2) {
    return { body: markdown, actions: [] };
  }

  const actions = collected.reverse();
  const body = lines.slice(0, i + 1).join('\n').replace(/\s+$/, '');
  return { body, actions };
}
