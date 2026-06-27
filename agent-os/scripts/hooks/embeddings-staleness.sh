#!/usr/bin/env bash
# embeddings-staleness.sh — pre-commit warning when embeddings drift.
#
# Sprint 46.6.6 — Semantic Recall (optional).
# Soft warning (never blocks): if INDEX.aaak.jsonl or any per-agent diary.md
# is staged but agent-os/embeddings.json mtime is older than the source files,
# print a one-line note suggesting embeddings-rebuild.sh.
#
# Skipped entirely when MEMORY_SEMANTIC_RECALL=off.
#
# Wire into .husky/pre-commit AFTER the memory-index-staleness guard.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

MODE="${MEMORY_SEMANTIC_RECALL:-off}"
if [ "$MODE" = "off" ]; then exit 0; fi

EMBED="agent-os/embeddings.json"
STAGED=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null \
  | grep -E '^(agent-os/memories/INDEX\.aaak\.jsonl|agent-os/sub-agents/[^/]+/diary\.md)$' \
  || true)

if [ -z "$STAGED" ]; then exit 0; fi
if [ ! -f "$EMBED" ]; then
  echo "⚠ embeddings-staleness: $EMBED missing while MEMORY_SEMANTIC_RECALL=$MODE — run: bash agent-os/scripts/embeddings-rebuild.sh" >&2
  exit 0
fi

# We use git's index to detect "changed source vs cache" rather than mtime
# (mtime may not reflect git index state). Any staged source mod ⇒ warn.
echo "⚠ embeddings-staleness: source corpus changed; consider running 'bash agent-os/scripts/embeddings-rebuild.sh' to refresh $EMBED (warn-only, MEMORY_SEMANTIC_RECALL=$MODE)." >&2
exit 0
