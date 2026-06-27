#!/bin/bash
# agent-os/scripts/hooks/sprint-close-gate-hook.sh
# PreToolUse hook on Bash: Blocks PR creation until close-out gates pass.
#
# Scope-aware:
#   - "agent-os", "docs", "tooling" → EXEMPT (no close-out gate needed)
#   - "production", "mixed" → MUST pass sprint close-out gates
#
# Triggers on: "gh pr create", "git push" (when sprint branch detected)
# Finds the active sprint spec and workfile from the current branch context.
# Runs sprint-gate-runner.sh --close. Exit 2 = BLOCK.
#
# Input: JSON via stdin from Claude Code hook system
# Exit: 0 = allow, 2 = block

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

INPUT=$(cat) || true
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || true

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Trigger on PR creation commands
IS_PR_COMMAND=false
if echo "$COMMAND" | grep -q 'gh pr create'; then
  IS_PR_COMMAND=true
fi

# Also trigger on git push if on a sprint branch
IS_SPRINT_PUSH=false
if echo "$COMMAND" | grep -q 'git push'; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  if echo "$BRANCH" | grep -qP 'sprint/\d+\.\d+\.\d+'; then
    IS_SPRINT_PUSH=true
  fi
fi

if [ "$IS_PR_COMMAND" = false ] && [ "$IS_SPRINT_PUSH" = false ]; then
  exit 0
fi

cd "$REPO_ROOT"

# Check scope — exempt non-production work
SCOPE=$(bash "$SCRIPT_DIR/scope-detector.sh" 2>/dev/null || echo "unknown")

if [ "$SCOPE" = "agent-os" ] || [ "$SCOPE" = "docs" ] || [ "$SCOPE" = "tooling" ] || [ "$SCOPE" = "none" ]; then
  # Non-production scope — skip close-out gates
  exit 0
fi

echo "" >&2
echo "═══════════════════════════════════════════════════════════════" >&2
echo "  SPRINT CLOSE-OUT GATE (Hook-Enforced)" >&2
echo "  Scope: $SCOPE (production rules apply)" >&2
echo "═══════════════════════════════════════════════════════════════" >&2
echo "" >&2

# ── Find the active sprint spec ──
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
BASE_BRANCH="main"
SPEC_FILE=""
WORK_FILE=""

# Method 1: Find sprint specs in the diff against main
if git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
  SPECS=$(git diff --name-only "$BASE_BRANCH"...HEAD 2>/dev/null \
    | grep -P '^docs/product/phases/phase-\d+/sprint-.*\.md$' \
    | grep -v -- '-workfile\.md$' \
    | grep -vi 'README' \
    || true)

  if [ -n "$SPECS" ]; then
    SPEC_FILE=$(echo "$SPECS" | head -1)
  fi
fi

# Method 2: Check recently modified sprint specs
if [ -z "$SPEC_FILE" ]; then
  SPEC_FILE=$(find docs/product/phases -name 'sprint-*.md' \
    ! -name '*-workfile.md' \
    ! -iname 'README*' \
    -newer .git/HEAD \
    -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn \
    | head -1 \
    | cut -d' ' -f2- \
    || true)
fi

# If no sprint spec found, allow (might not be a sprint)
if [ -z "$SPEC_FILE" ] || [ ! -f "$SPEC_FILE" ]; then
  echo "  ⚠ No sprint spec found — skipping close-out gate." >&2
  echo "  ⚠ If this IS a sprint, create the spec first." >&2
  exit 0
fi

echo "  Sprint spec: $SPEC_FILE" >&2

# Find matching workfile
SPEC_DIR=$(dirname "$SPEC_FILE")
SPEC_BASE=$(basename "$SPEC_FILE" .md)
WORKFILE_PATH="${SPEC_DIR}/${SPEC_BASE}-workfile.md"

if [ -f "$WORKFILE_PATH" ]; then
  WORK_FILE="$WORKFILE_PATH"
  echo "  Work file:   $WORK_FILE" >&2
else
  echo "" >&2
  echo "BLOCKED: Close-out gate requires a work file." >&2
  echo "Expected: $WORKFILE_PATH" >&2
  echo "Create the work file before creating the PR." >&2
  exit 2
fi

echo "" >&2

# Run the close-out gate
if [ -f "agent-os/scripts/sprint-gate-runner.sh" ]; then
  GATE_OUTPUT=$(bash agent-os/scripts/sprint-gate-runner.sh --close "$SPEC_FILE" "$WORK_FILE" 2>&1) || true
  GATE_EXIT=$?
  echo "$GATE_OUTPUT" >&2

  if [ $GATE_EXIT -ne 0 ]; then
    echo "" >&2
    echo "══════════════════════════════════════════════════════════════" >&2
    echo "  ✗ CLOSE-OUT GATE FAILED — BLOCKED" >&2
    echo "  Fix the issues above, then retry." >&2
    echo "══════════════════════════════════════════════════════════════" >&2
    exit 2
  fi

  echo "" >&2
  echo "✓ Close-out gate PASSED." >&2
else
  echo "  ⚠ sprint-gate-runner.sh not found — skipping gate check." >&2
fi

exit 0
