#!/usr/bin/env bash
# facts-append.sh — append one fact to agent-os/facts.jsonl.
#
# Sprint 46.6.1 — Agent OS Memory v2: Temporal Facts Layer.
# Usage:
#   bash agent-os/scripts/facts-append.sh "<subject>|<predicate>|<object>|<valid_from>[|<valid_to>]" --source <file> --sprint <id>
#
# Example:
#   bash agent-os/scripts/facts-append.sh "R-33|supersedes|R-12|2026-04-12" --source agent-os/RULES.md --sprint 46.0.0
#
# Validation: subject/predicate/object non-empty; valid_from/to ISO-8601 dates.
# Duplicate IDs print "already recorded" and exit 0 (idempotent re-runs are valid).

set -euo pipefail

if [ $# -lt 1 ]; then
  cat >&2 <<EOF
Usage: bash agent-os/scripts/facts-append.sh "<subject>|<predicate>|<object>|<valid_from>[|<valid_to>]" --source <file> --sprint <id>
EOF
  exit 2
fi

TRIPLE="$1"; shift
SOURCE=""
SPRINT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --sprint) SPRINT="$2"; shift 2 ;;
    *) echo "facts-append: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

TRIPLE="$TRIPLE" SOURCE="$SOURCE" SPRINT="$SPRINT" node --input-type=module -e '
import { factId, appendFact, validateInput, nowIsoSeconds } from "./agent-os/scripts/facts-lib.mjs";

const triple = process.env.TRIPLE || "";
const parts = triple.split("|");
const [subject, predicate, object, valid_from, valid_to] = parts;
const errors = validateInput({ subject, predicate, object, valid_from, valid_to });
if (errors.length) {
  console.error("facts-append validation failed:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

const fact = {
  id: factId(subject, predicate, object, valid_from),
  subject, predicate, object,
  valid_from: valid_from || null,
  valid_to: valid_to || null,
  confidence: 1.0,
  source_file: process.env.SOURCE || null,
  sprint: process.env.SPRINT || null,
  extracted_at: nowIsoSeconds(),
};

const result = appendFact(fact);
if (result.written) {
  console.log(`facts-append: wrote ${fact.id}  ${subject}|${predicate}|${object}|${valid_from || "-"}${valid_to ? "|" + valid_to : ""}`);
} else {
  console.log(`facts-append: ${fact.id} already recorded`);
}
'
