#!/bin/bash
# agent-os/scripts/hooks/no-skip-failures.sh
# PostToolUse hook on Bash: After running tests, check if there are
# failures and block if the agent tries to proceed without fixing them.
#
# This hook checks test log files after test commands complete.
# If failures are detected in the log, it reminds the agent that
# ALL failures must be fixed — including pre-existing ones.
#
# Input: JSON via stdin from Claude Code hook system
#   { "tool_name": "Bash", "tool_input": { "command": "..." }, "tool_output": "..." }
# Exit: 0 = allow, 2 = block (stderr sent to Claude as feedback)

set -euo pipefail

INPUT=$(cat) || true
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || true
OUTPUT=$(echo "$INPUT" | jq -r '.tool_output // empty' 2>/dev/null) || true

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only check commands that run tests (full suite runs)
if ! echo "$COMMAND" | grep -qE '(npx vitest run|npm run test|npm test).*tee'; then
  exit 0
fi

# Check if the output contains test failures
FAILED_COUNT=$(echo "$OUTPUT" | grep -oP '\d+(?= failed)' | head -1)

if [ -n "$FAILED_COUNT" ] && [ "$FAILED_COUNT" -gt 0 ]; then
  cat >&2 <<FEEDBACK
WARNING: $FAILED_COUNT test(s) failed. You MUST fix ALL failures before proceeding.

Rules:
  - NEVER skip a failure because it is "pre-existing" or "not related to my changes"
  - Pre-existing failures are technical debt — fix them when you find them
  - Every test suite run must end with 0 failures before committing
  - If a failure is genuinely unrelated, fix it in the same commit or a separate one

Check the log file for details:
  grep -E "FAIL|×" tmp/test-backend.log
  grep -E "FAIL|×" tmp/test-frontend.log
FEEDBACK
  # Exit 0 (warning, not blocking) — the agent sees the message and must act on it
  # Using exit 0 so the tool result is still returned, but the warning is appended
  exit 0
fi

exit 0
