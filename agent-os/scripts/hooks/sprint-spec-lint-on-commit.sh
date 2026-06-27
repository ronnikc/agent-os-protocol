#!/bin/bash
# agent-os/scripts/hooks/sprint-spec-lint-on-commit.sh
# PreToolUse hook: Auto-run lint-sprint-spec.sh when committing sprint spec files.
# Enforces R-27: Sprint specs must pass Gate -2 before commit.
#
# Input: JSON via stdin from Claude Code hook system
#   { "tool_name": "Bash", "tool_input": { "command": "git commit ..." }, ... }
# Exit: 0 = pass (or no sprint specs staged), 2 = block

set -euo pipefail

# Read JSON from stdin, extract the bash command
INPUT=$(cat) || true
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || true

# Only trigger on git commit commands
if [ -z "$COMMAND" ] || ! echo "$COMMAND" | grep -q 'git commit'; then
  exit 0
fi

# Check if any sprint spec files (or fix-sprint specs) are staged
# (exclude work files and deleted files).
#
# fix-sprint-20260411-0417 Findings 36 + 37:
#   - Finding 36 (hook regex coverage): the previous pattern only
#     matched `docs/product/phases/.*/sprint-.*\.md` and missed every
#     fix-sprint spec under `docs/product/fix-sprints/`. Extended
#     below so the lint also runs on fix-sprint specs.
#   - Finding 37 (hook diff-filter scope): `--diff-filter=AM` skipped
#     renames (filter letter `R`). A `git mv` of a sprint spec slipped
#     past lint entirely. Filter is now `AMR` so renames are
#     re-linted at their destination path.
SPRINT_SPECS=$(git diff --cached --diff-filter=AMR --name-only 2>/dev/null \
  | grep -E '(docs/product/phases/.*/sprint-.*\.md|docs/product/fix-sprints/fix-sprint-.*\.md)$' \
  | grep -v -E '(\-workfile\.md$|^docs/product/phases/.*/work-sprint-)' || true)

if [ -z "$SPRINT_SPECS" ]; then
  exit 0
fi

echo "Sprint Spec Lint (R-27): Checking staged sprint specs..." >&2

LINT_SCRIPT="agent-os/scripts/lint-sprint-spec.sh"

if [ ! -f "$LINT_SCRIPT" ]; then
  echo "WARNING: $LINT_SCRIPT not found, skipping Gate -2 lint." >&2
  exit 0
fi

FAILED=false

while IFS= read -r spec_file; do
  echo "  Linting: $spec_file" >&2
  if ! bash "$LINT_SCRIPT" "$spec_file" 2>&1 | tail -3 >&2; then
    echo "  FAILED: $spec_file" >&2
    FAILED=true
  fi
done <<< "$SPRINT_SPECS"

if [ "$FAILED" = true ]; then
  echo "BLOCKED: One or more sprint specs failed Gate -2 lint (R-27). Fix structural issues before committing." >&2
  exit 2
fi

echo "Sprint Spec Lint (R-27): PASSED" >&2
exit 0
