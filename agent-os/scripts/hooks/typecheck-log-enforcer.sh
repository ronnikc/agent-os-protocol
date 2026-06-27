#!/bin/bash
# agent-os/scripts/hooks/typecheck-log-enforcer.sh
# PreToolUse hook: Enforce that type-check runs log output properly.
#
# Problem: Running `npx tsc` with `| head -5` loses errors when there
# are many. This wastes time because you think it's clean, then discover
# more errors later and have to re-run. Logging to a file allows instant
# re-inspection without re-running.
#
# Rules enforced:
#   1. `npx tsc` commands MUST redirect output to a log file via `| tee`
#   2. Single-project type-checks (shared, backend, frontend) each get their own log
#   3. NEVER pipe through head/tail directly — use tee first, then check the log
#
# Input: JSON via stdin from Claude Code hook system
#   { "tool_name": "Bash", "tool_input": { "command": "..." }, ... }
# Exit: 0 = allow, 2 = block (stderr sent to Claude as feedback)

set -euo pipefail

INPUT=$(cat) || true
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || true

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only check commands that run type-checks
if ! echo "$COMMAND" | grep -qE 'npx tsc\b'; then
  exit 0
fi

# ── Rule 1: NEVER pipe tsc through head/tail directly ──
if echo "$COMMAND" | grep -qE 'tsc.*\|\s*(head|tail)\b' && ! echo "$COMMAND" | grep -qE 'tsc.*\|\s*tee\b'; then
  cat >&2 <<'FEEDBACK'
BLOCKED: Type-check output piped through head/tail loses errors.
Log output first, then inspect the log.

Correct patterns:
  # Shared (always build first):
  npx tsc -p src/shared/tsconfig.json 2>&1 | tee tmp/tsc-shared.log

  # Backend type-check:
  npx tsc -p src/backend/tsconfig.json --noEmit 2>&1 | tee tmp/tsc-backend.log

  # Frontend type-check:
  npx tsc -p src/frontend/tsconfig.json --noEmit 2>&1 | tee tmp/tsc-frontend.log

  # After running, check results:
  tail -20 tmp/tsc-backend.log
  grep -c "error TS" tmp/tsc-frontend.log   # Count errors
FEEDBACK
  exit 2
fi

# ── Rule 2: Full type-check runs SHOULD log output ──
# Only enforce logging for commands that don't already redirect
# Allow commands without logging but warn (soft rule — don't block)
# The hard block above for head/tail is the critical one.

exit 0
