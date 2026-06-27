#!/usr/bin/env bash
# memory-index-staleness.sh — pre-commit guard for the AAAK memory index.
#
# Sprint 46.6.0 — Agent OS Memory v2: Memory Index + Layered Load.
# Fails the commit if any tracked memory file under
#   - agent-os/memories/**/*.md
#   - agent-os/sub-agents/memories/**/*.md   (and post-46.6.2: sub-agents/<name>/lessons/*.md)
# is staged, but agent-os/memories/INDEX.aaak.jsonl is NOT also staged.
#
# Wired from .husky/pre-commit after lint-staged.
#
# Exit codes:
#   0 — no memory edits, or INDEX.aaak.jsonl correctly regenerated
#   1 — memory file edited without regenerating INDEX

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

# What memory files are staged in this commit?
STAGED_MEMORY=$(git diff --cached --name-only --diff-filter=ACMR \
  | grep -E '^(agent-os/memories/.*\.md|agent-os/sub-agents/memories/.*\.md|agent-os/sub-agents/[^/]+/lessons/.*\.md)$' \
  | grep -v '^agent-os/memories/README\.md$' \
  | grep -v '^agent-os/sub-agents/memories/README\.md$' \
  | grep -v '^agent-os/memories/INDEX\.aaak\.jsonl$' \
  || true)

if [ -z "$STAGED_MEMORY" ]; then
  exit 0
fi

# Memory files were staged — INDEX.aaak.jsonl must also be staged.
INDEX_STAGED=$(git diff --cached --name-only --diff-filter=ACMR \
  | grep -c '^agent-os/memories/INDEX\.aaak\.jsonl$' \
  || true)

if [ "$INDEX_STAGED" -gt 0 ]; then
  exit 0
fi

cat <<EOF >&2

✗ Memory index is stale.

The following memory files are staged for commit:
$(echo "$STAGED_MEMORY" | sed 's/^/    /')

But agent-os/memories/INDEX.aaak.jsonl is NOT staged. Regenerate it with:

    bash agent-os/scripts/build-memory-index.sh
    git add agent-os/memories/INDEX.aaak.jsonl

Then re-commit. (See agent-os/MEMORY.md → Loading Layers for the layered-load
contract this guard protects.)

EOF
exit 1
