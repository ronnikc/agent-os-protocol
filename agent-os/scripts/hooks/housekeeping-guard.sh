#!/bin/bash
# agent-os/scripts/hooks/housekeeping-guard.sh
# PreToolUse hook on Bash: Blocks production sprint pushes/PRs unless
# housekeeping is done (STATE.md updated, lessons learned, sprint count).
#
# Scope-aware: only enforces for production/mixed scope.
# Triggers on: "git push", "gh pr create"
#
# Checks:
# 1. STATE.md was modified in this branch (sprint status should be updated)
# 2. Sprint workfile exists (lessons learned go there)
# 3. No FIXME/HACK/XXX in staged files
#
# Exit: 0 = pass, 2 = block

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

INPUT=$(cat) || true
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || true

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only trigger on push or PR creation
if ! echo "$COMMAND" | grep -qE 'git push|gh pr create'; then
  exit 0
fi

cd "$REPO_ROOT"

# Check scope
SCOPE=$(bash "$SCRIPT_DIR/scope-detector.sh" 2>/dev/null || echo "unknown")

if [ "$SCOPE" = "agent-os" ] || [ "$SCOPE" = "docs" ] || [ "$SCOPE" = "tooling" ] || [ "$SCOPE" = "none" ]; then
  exit 0
fi

# Only check if on a sprint branch
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
IS_SPRINT=false
if echo "$BRANCH" | grep -qP 'sprint/\d+\.\d+\.\d+'; then
  IS_SPRINT=true
fi

# For non-sprint production pushes, just check for FIXME/HACK/XXX
STAGED=$(git diff --cached --name-only 2>/dev/null || true)
if [ -z "$STAGED" ]; then
  # Check diff against main for pushes
  STAGED=$(git diff --name-only main...HEAD 2>/dev/null || true)
fi

# Check for FIXME/HACK/XXX in production files
SRC_FILES=$(echo "$STAGED" | grep '^src/' || true)
if [ -n "$SRC_FILES" ]; then
  VIOLATIONS=""
  for file in $SRC_FILES; do
    if [ -f "$file" ]; then
      FOUND=$(grep -nE '\b(FIXME|HACK|XXX)\b' "$file" 2>/dev/null | head -3 || true)
      if [ -n "$FOUND" ]; then
        VIOLATIONS="${VIOLATIONS}  ${file}:\n${FOUND}\n"
      fi
    fi
  done
  if [ -n "$VIOLATIONS" ]; then
    echo "" >&2
    echo "BLOCKED: FIXME/HACK/XXX found in production files:" >&2
    echo -e "$VIOLATIONS" >&2
    echo "Remove or resolve these before pushing." >&2
    exit 2
  fi
fi

# Sprint-specific housekeeping checks (BLOCKING for production sprints)
if [ "$IS_SPRINT" = true ]; then
  echo "Housekeeping Guard: Sprint branch detected — checking governance..." >&2
  BLOCKED=false

  # Check 1: STATE.md must be modified in the branch
  STATE_MODIFIED=$(git diff --name-only main...HEAD 2>/dev/null | grep '^agent-os/STATE.md$' || true)
  if [ -z "$STATE_MODIFIED" ]; then
    echo "" >&2
    echo "BLOCKED: agent-os/STATE.md was not updated in this sprint branch." >&2
    echo "Update STATE.md with sprint completion status before pushing." >&2
    BLOCKED=true
  fi

  # Check 2: Sprint workfile must exist
  SPRINT_ID=$(echo "$BRANCH" | grep -oP '\d+\.\d+\.\d+' || true)
  if [ -n "$SPRINT_ID" ]; then
    WORKFILE=$(find docs/product/phases -name "sprint-${SPRINT_ID}-workfile.md" 2>/dev/null | head -1)
    if [ -z "$WORKFILE" ]; then
      echo "" >&2
      echo "BLOCKED: No workfile found for sprint ${SPRINT_ID}." >&2
      echo "Expected: docs/product/phases/phase-*/sprint-${SPRINT_ID}-workfile.md" >&2
      echo "Create the workfile with lessons learned before pushing." >&2
      BLOCKED=true
    fi
  fi

  if [ "$BLOCKED" = true ]; then
    echo "" >&2
    echo "══════════════════════════════════════════════════════════════" >&2
    echo "  ✗ HOUSEKEEPING GATE FAILED — PUSH/PR BLOCKED" >&2
    echo "  Production sprint branches require:" >&2
    echo "    1. STATE.md updated with sprint status" >&2
    echo "    2. Sprint workfile with lessons learned" >&2
    echo "    3. No FIXME/HACK/XXX in src/ files" >&2
    echo "══════════════════════════════════════════════════════════════" >&2
    exit 2
  fi

  echo "Housekeeping Guard: PASSED" >&2
fi

exit 0
