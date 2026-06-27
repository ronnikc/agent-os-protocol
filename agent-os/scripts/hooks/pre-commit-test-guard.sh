#!/bin/bash
# agent-os/scripts/hooks/pre-commit-test-guard.sh
# PreToolUse hook: Before git commit, verify tests were run for production code.
# Enforces R-03: Tests must pass for modified modules BEFORE committing.
#
# Scope-aware (uses scope-detector.sh):
#   - "production" or "mixed" → BLOCKS unless fresh test logs exist
#   - "agent-os", "docs", "tooling" → EXEMPT (no test required)
#
# Checks for fresh test logs in tmp/ (must exist and be < 30 min old).
# Does NOT run tests itself — that would be too slow in a hook.
# Instead, blocks the commit and tells the agent to run tests first.
#
# Input: JSON via stdin from Claude Code hook system
# Exit: 0 = pass, 2 = block

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

INPUT=$(cat) || true
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || true

# Only trigger on git commit commands
if [ -z "$COMMAND" ] || ! echo "$COMMAND" | grep -q 'git commit'; then
  exit 0
fi

cd "$REPO_ROOT"

# Determine scope
SCOPE=$(bash "$SCRIPT_DIR/scope-detector.sh" 2>/dev/null || echo "unknown")

# Exempt non-production scopes
if [ "$SCOPE" = "agent-os" ] || [ "$SCOPE" = "docs" ] || [ "$SCOPE" = "tooling" ] || [ "$SCOPE" = "none" ]; then
  exit 0
fi

# Production or mixed scope — verify recent test logs exist
echo "Test Guard (R-03): Production code staged (scope: $SCOPE) — checking for recent test logs..." >&2

MAX_AGE_MIN=30
NOW=$(date +%s)
BACKEND_OK=false
FRONTEND_OK=false

# Check which modules have changes
STAGED_FILES=$(git diff --cached --name-only 2>/dev/null || true)
BACKEND_CHANGED=false
FRONTEND_CHANGED=false

if echo "$STAGED_FILES" | grep -q '^src/backend/\|^src/shared/'; then
  BACKEND_CHANGED=true
fi
if echo "$STAGED_FILES" | grep -q '^src/frontend/\|^src/shared/'; then
  FRONTEND_CHANGED=true
fi

# Check backend test log freshness
if [ "$BACKEND_CHANGED" = true ]; then
  if [ -f "tmp/test-backend.log" ]; then
    LOG_AGE=$(( NOW - $(stat -c %Y "tmp/test-backend.log" 2>/dev/null || echo 0) ))
    LOG_AGE_MIN=$(( LOG_AGE / 60 ))
    if [ "$LOG_AGE_MIN" -lt "$MAX_AGE_MIN" ]; then
      # Check if tests actually passed
      if tail -5 "tmp/test-backend.log" | grep -q "Tests.*passed\|0 failed\| passed"; then
        BACKEND_OK=true
        echo "Test Guard: Backend tests PASSED (log ${LOG_AGE_MIN}m old)" >&2
      else
        echo "" >&2
        echo "BLOCKED: Backend test log exists but tests FAILED." >&2
        echo "Fix failures and re-run: npx vitest run --config src/backend/vitest.config.ts 2>&1 | tee tmp/test-backend.log" >&2
        exit 2
      fi
    else
      echo "" >&2
      echo "BLOCKED: Backend test log is ${LOG_AGE_MIN}m old (max ${MAX_AGE_MIN}m). Re-run tests." >&2
      echo "Run: npx vitest run --config src/backend/vitest.config.ts 2>&1 | tee tmp/test-backend.log" >&2
      exit 2
    fi
  else
    echo "" >&2
    echo "BLOCKED: No backend test log found (tmp/test-backend.log)." >&2
    echo "Run: npx vitest run --config src/backend/vitest.config.ts 2>&1 | tee tmp/test-backend.log" >&2
    exit 2
  fi
fi

# Check frontend test log freshness
if [ "$FRONTEND_CHANGED" = true ]; then
  if [ -f "tmp/test-frontend.log" ]; then
    LOG_AGE=$(( NOW - $(stat -c %Y "tmp/test-frontend.log" 2>/dev/null || echo 0) ))
    LOG_AGE_MIN=$(( LOG_AGE / 60 ))
    if [ "$LOG_AGE_MIN" -lt "$MAX_AGE_MIN" ]; then
      if tail -5 "tmp/test-frontend.log" | grep -q "Tests.*passed\|0 failed\| passed"; then
        FRONTEND_OK=true
        echo "Test Guard: Frontend tests PASSED (log ${LOG_AGE_MIN}m old)" >&2
      else
        echo "" >&2
        echo "BLOCKED: Frontend test log exists but tests FAILED." >&2
        echo "Fix failures and re-run: npx vitest run --config src/frontend/vitest.config.ts 2>&1 | tee tmp/test-frontend.log" >&2
        exit 2
      fi
    else
      echo "" >&2
      echo "BLOCKED: Frontend test log is ${LOG_AGE_MIN}m old (max ${MAX_AGE_MIN}m). Re-run tests." >&2
      echo "Run: npx vitest run --config src/frontend/vitest.config.ts 2>&1 | tee tmp/test-frontend.log" >&2
      exit 2
    fi
  else
    echo "" >&2
    echo "BLOCKED: No frontend test log found (tmp/test-frontend.log)." >&2
    echo "Run: npx vitest run --config src/frontend/vitest.config.ts 2>&1 | tee tmp/test-frontend.log" >&2
    exit 2
  fi
fi

echo "Test Guard (R-03): PASSED" >&2
exit 0
