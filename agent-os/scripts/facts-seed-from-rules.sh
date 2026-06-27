#!/usr/bin/env bash
# facts-seed-from-rules.sh — one-time seed pass over RULES.md + STATE.md.
#
# Sprint 46.6.1 — Agent OS Memory v2: Temporal Facts Layer.
# Idempotent: re-running on an already-seeded JSONL produces zero new lines
# (deterministic IDs ensure duplicate detection).
#
# Emits:
#   - One {subject:"R-NN", predicate:"introduced_at", object:"<sprint or date>"} fact per R-* rule
#   - One {subject:"Phase N", predicate:"status", object:"<state word>"} fact per STATE.md row
#
# Usage:  bash agent-os/scripts/facts-seed-from-rules.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

node --input-type=module -e '
import { readFileSync } from "node:fs";
import { factId, appendFact, nowIsoSeconds, readAllFacts } from "./agent-os/scripts/facts-lib.mjs";

const TODAY = new Date().toISOString().slice(0, 10);
let added = 0, skipped = 0;

function emit(fact) {
  // Re-running the seed must produce zero new lines; sleep zero, but stamp
  // identical extracted_at *seconds* on duplicates so dedup-by-content works.
  const r = appendFact(fact);
  if (r.written) added++;
  else           skipped++;
}

// ── R-* rules from RULES.md ─────────────────────────────────────────────
const rulesText = readFileSync("agent-os/RULES.md", "utf8");
for (const line of rulesText.split(/\r?\n/)) {
  const m = line.match(/^\|\s*(R-\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/);
  if (!m) continue;
  const [, rule, , origin] = m;

  // Parse origin column: prefer "Sprint X.Y.Z" then ISO date; fall back to "unspecified".
  let object = "unspecified";
  let valid_from = TODAY;
  const sprintMatch = origin.match(/Sprint\s+(\d+\.\d+(?:\.\d+){0,2})/i);
  const dateMatch = origin.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (sprintMatch) {
    object = `sprint:${sprintMatch[1]}`;
  }
  if (dateMatch) {
    valid_from = dateMatch[1];
    if (!sprintMatch) object = `date:${dateMatch[1]}`;
  }

  emit({
    id: factId(rule, "introduced_at", object, valid_from),
    subject: rule,
    predicate: "introduced_at",
    object,
    valid_from,
    valid_to: null,
    confidence: 1.0,
    source_file: "agent-os/RULES.md",
    sprint: "46.6.1",
    extracted_at: nowIsoSeconds(),
  });

  // Supersession marker — when origin mentions "(supersedes R-N)" prose.
  const supersedesMatch = origin.match(/supersedes?\s+(R-\d+)/i);
  if (supersedesMatch) {
    const replaced = supersedesMatch[1];
    emit({
      id: factId(rule, "supersedes", replaced, valid_from),
      subject: rule,
      predicate: "supersedes",
      object: replaced,
      valid_from,
      valid_to: null,
      confidence: 1.0,
      source_file: "agent-os/RULES.md",
      sprint: "46.6.1",
      extracted_at: nowIsoSeconds(),
    });
  }
}

// ── Phase status from STATE.md ──────────────────────────────────────────
const stateText = readFileSync("agent-os/STATE.md", "utf8");
for (const line of stateText.split(/\r?\n/)) {
  // Match table rows like: | 21 | Phase Title | sprint range | Complete (15/15) |
  const m = line.match(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
  if (!m) continue;
  const phaseNum = m[1];
  const status = m[4].toLowerCase();
  let object = "unknown";
  if (/complete/.test(status))  object = "delivered";
  else if (/active/.test(status)) object = "active";
  else if (/pending/.test(status)) object = "pending";
  else continue;

  emit({
    id: factId(`Phase ${phaseNum}`, "status", object, TODAY),
    subject: `Phase ${phaseNum}`,
    predicate: "status",
    object,
    valid_from: TODAY,
    valid_to: null,
    confidence: 1.0,
    source_file: "agent-os/STATE.md",
    sprint: "46.6.1",
    extracted_at: nowIsoSeconds(),
  });
}

// Final counts.
const total = readAllFacts().length;
console.log(`facts-seed: +${added} new, ${skipped} duplicates skipped, ${total} total facts`);
'
