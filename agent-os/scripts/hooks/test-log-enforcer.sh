#!/bin/bash
# agent-os/scripts/hooks/test-log-enforcer.sh
# PreToolUse hook: Enforce that test runs log output to a file.
#
# Problem: Running full test suites (2-4 min each) then piping through
# tail/head/grep to check results wastes significant time when output
# is lost and tests must be re-run. Logging to a file allows instant
# re-inspection without re-running.
#
# Rules enforced:
#   1. vitest/npm test commands MUST redirect output to a log file
#   2. Correct workspace commands must be used (not wrong configs)
#   3. Frontend tests must run from src/frontend or use -w flag
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

# Only check commands that run tests
IS_TEST_CMD=false

# Match vitest run (full suite runs, not single-file targeted runs)
if echo "$COMMAND" | grep -qE '(npx vitest run|npm run test|npm test)'; then
  IS_TEST_CMD=true
fi

if [ "$IS_TEST_CMD" = false ]; then
  exit 0
fi

# ── Rule 1: Targeted single-file test runs are exempt from logging ──
# If running a specific test file (path contains __tests__ or .test.), allow without logging
# Note: --config may appear between "vitest run" and the file path, so we check the whole command
if echo "$COMMAND" | grep -qE '\.(test|spec)\.(ts|tsx)\b' ; then
  # Single file run — exempt from log requirement
  :
elif echo "$COMMAND" | grep -qE '__tests__/' ; then
  # Single directory run — exempt from log requirement
  :
else
  # ── Rule 2a: Frontend full-suite runs MUST use the CI-style sharded runner ──
  # The CI runs 6 shards serially with --dangerouslyIgnoreUnhandledErrors and
  # 3GB heap. Running the frontend suite in one process causes worker crashes
  # (memory/child process exhaustion). Mirror CI behavior locally.
  if echo "$COMMAND" | grep -qE 'vitest run.*src/frontend/vitest\.config\.ts'; then
    # Exempt: already uses the wrapper script, or explicitly passes --shard
    if echo "$COMMAND" | grep -qE '(run-frontend-tests-ci\.sh|--shard=)'; then
      : # allow
    else
      cat >&2 <<'FEEDBACK'
BLOCKED: Frontend full-suite runs must use the CI-style sharded runner.
Running vitest against src/frontend/ in one process causes worker crashes
that don't happen in CI (which splits into 6 serialized shards with 3GB heap).

Correct pattern:
  bash agent-os/scripts/run-frontend-tests-ci.sh

This runs all 6 shards serially, mirroring .github/workflows/ci.yml exactly:
  - --shard=1/6 through --shard=6/6
  - --dangerouslyIgnoreUnhandledErrors
  - NODE_OPTIONS=--max-old-space-size=3072

Output: tmp/test-frontend.log (combined) + tmp/test-frontend-shard-N.log (per shard)

To run a single shard:
  bash agent-os/scripts/run-frontend-tests-ci.sh 3

For single-file tests (unchanged):
  npx vitest run --config vitest.config.ts path/to/file.test.tsx
FEEDBACK
      exit 2
    fi
  fi

  # ── Rule 2b: Full suite runs MUST log output ──
  # Check for output redirection (tee, >, 2>&1 > file, etc.)
  # The wrapper script writes its own log, so it's exempt.
  if echo "$COMMAND" | grep -qE 'run-frontend-tests-ci\.sh'; then
    : # wrapper script writes tmp/test-frontend.log itself
  elif ! echo "$COMMAND" | grep -qE '(tee\s|>\s*\S+\.log|>\s*tmp/|>\s*/tmp/)'; then
    cat >&2 <<'FEEDBACK'
BLOCKED: Full test suite runs must log output to a file.
This prevents wasting time re-running tests just to check results.

Correct patterns:
  # Backend tests (from repo root):
  npx vitest run --config src/backend/vitest.config.ts 2>&1 | tee tmp/test-backend.log

  # Frontend tests (from repo root, CI-style 6 shards):
  bash agent-os/scripts/run-frontend-tests-ci.sh

  # All tests:
  npm run test:all 2>&1 | tee tmp/test-all.log

  # Single file (no log needed):
  npx vitest run path/to/my-service.test.ts

After running, check results:  tail -20 tmp/test-backend.log
FEEDBACK
    exit 2
  fi
fi

# ── Rule 3: Don't use wrong vitest config ──
# Catch: vitest run --config vite.config.ts (frontend build config, not test config)
if echo "$COMMAND" | grep -qE 'vitest.*--config\s+vite\.config\.ts'; then
  echo "BLOCKED: Wrong config. Use --config src/frontend/vitest.config.ts or --config src/backend/vitest.config.ts (not vite.config.ts)." >&2
  exit 2
fi

# ── Rule 4: Don't run frontend tests with backend config or vice versa ──
# Catch: running vitest from root without any config (uses root vitest.config.ts which is backend-only)
# and expecting frontend tests to be included
if echo "$COMMAND" | grep -qE 'vitest run\s+src/frontend' && ! echo "$COMMAND" | grep -qE '(--config|cd src/frontend|-w @agent-os/frontend)'; then
  echo "BLOCKED: Frontend tests need frontend config. Use: npx vitest run --config src/frontend/vitest.config.ts src/..." >&2
  exit 2
fi

exit 0
