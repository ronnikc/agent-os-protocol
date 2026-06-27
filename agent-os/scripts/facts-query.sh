#!/usr/bin/env bash
# facts-query.sh — query facts.jsonl with the temporal filter.
#
# Sprint 46.6.1 — Agent OS Memory v2: Temporal Facts Layer.
# Usage:
#   bash agent-os/scripts/facts-query.sh subject:R-33                # all current facts about R-33
#   bash agent-os/scripts/facts-query.sh subject:R-12 --as-of 2026-04-11  # R-12 as it was on that date
#   bash agent-os/scripts/facts-query.sh predicate:supersedes        # every supersession
#   bash agent-os/scripts/facts-query.sh object:R-12                 # everything that points at R-12
#   bash agent-os/scripts/facts-query.sh subject:R-33 --json         # raw JSONL output
#
# Filter syntax: <field>:<value>  where field ∈ {subject, predicate, object}.
# Multiple filters combine with AND.

set -euo pipefail

ASOF=""
JSON=0
SUBJECT=""
PREDICATE=""
OBJECT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --as-of) ASOF="$2"; shift 2 ;;
    --json)  JSON=1; shift ;;
    subject:*)   SUBJECT="${1#subject:}"; shift ;;
    predicate:*) PREDICATE="${1#predicate:}"; shift ;;
    object:*)    OBJECT="${1#object:}"; shift ;;
    *) echo "facts-query: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

SUBJECT="$SUBJECT" PREDICATE="$PREDICATE" OBJECT="$OBJECT" ASOF="$ASOF" JSON_OUT="$JSON" \
  node --input-type=module -e '
import { queryFacts, formatFactLine } from "./agent-os/scripts/facts-lib.mjs";

const filters = {
  subject: process.env.SUBJECT || null,
  predicate: process.env.PREDICATE || null,
  object: process.env.OBJECT || null,
  asOf: process.env.ASOF || null,
};
const matches = queryFacts(filters);
if (process.env.JSON_OUT === "1") {
  for (const f of matches) console.log(JSON.stringify(f));
} else {
  for (const f of matches) console.log(formatFactLine(f));
  console.error(`(${matches.length} fact(s))`);
}
'
