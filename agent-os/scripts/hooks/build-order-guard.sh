#!/bin/bash
# agent-os/scripts/hooks/build-order-guard.sh
# PreToolUse hook: Before git commit, verify build order (shared → backend → frontend).
# Enforces R-01: Build order is sacred.
#
# Cache: Writes .guard-cache/build-passed after success. On next run, skips
# if no src/ files changed since the cache timestamp. This avoids redundant
# rebuilds when the agent already built successfully before committing.
#
# Input: JSON via stdin from Claude Code hook system
#   { "tool_name": "Bash", "tool_input": { "command": "git commit ..." }, ... }
# Exit: 0 = pass, 2 = block

set -euo pipefail

INPUT=$(cat) || true
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || true

# Only trigger on git commit commands
if [ -z "$COMMAND" ] || ! echo "$COMMAND" | grep -q 'git commit'; then
  exit 0
fi

# Skip for docs-only commits: if all staged files are outside src/, no build needed
STAGED_SRC=$(git diff --cached --name-only -- 'src/' 2>/dev/null | head -1)
if [ -z "$STAGED_SRC" ]; then
  echo "Build Order Guard: SKIPPED (no src/ files staged — docs-only commit)" >&2
  exit 0
fi

CACHE_DIR=".guard-cache"
CACHE_FILE="$CACHE_DIR/build-passed"

# Check cache: skip if no src/ files modified since last successful build
if [ -f "$CACHE_FILE" ]; then
  NEWER_FILES=$(find src/ -name '*.ts' -o -name '*.tsx' -newer "$CACHE_FILE" 2>/dev/null | head -1)
  if [ -z "$NEWER_FILES" ]; then
    echo "Build Order Guard: SKIPPED (no src/ changes since last verified build)" >&2
    exit 0
  fi
fi

echo "Build Order Guard: Checking R-01 compliance before commit..." >&2

# Step 1: Build shared (required before backend or frontend)
if ! npx tsc -p src/shared/tsconfig.json 2>/dev/null; then
  echo "BLOCKED: src/shared does not compile. Fix shared types first (R-01)." >&2
  exit 2
fi

# Step 2: Check backend
if ! npx tsc -p src/backend/tsconfig.json --noEmit 2>/dev/null; then
  echo "BLOCKED: src/backend does not compile. Fix backend errors (R-02)." >&2
  exit 2
fi

# Step 3: Check frontend
if ! npx tsc -p src/frontend/tsconfig.json --noEmit 2>/dev/null; then
  echo "BLOCKED: src/frontend does not compile. Fix frontend errors (R-02)." >&2
  exit 2
fi

# Cache success
mkdir -p "$CACHE_DIR"
touch "$CACHE_FILE"

echo "Build Order Guard: PASSED (shared → backend → frontend)" >&2
exit 0
