#!/bin/bash
# agent-os/scripts/hooks/block-no-verify.sh
# PreToolUse hook: Block git commands that skip verification hooks.
# Prevents --no-verify, --force, and other safety bypasses.
#
# Input: JSON via stdin from Claude Code hook system
#   { "tool_name": "Bash", "tool_input": { "command": "..." }, ... }
# Exit: 0 = allow, 2 = block (stderr sent to Claude as feedback)

set -euo pipefail

# Read JSON from stdin, extract the bash command
INPUT=$(cat) || true
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || true

# If we can't extract the command (no jq, or not Bash tool), allow
if [ -z "$COMMAND" ]; then
  exit 0
fi

# Block --no-verify (skips pre-commit hooks)
if echo "$COMMAND" | grep -q -- '--no-verify'; then
  echo "BLOCKED: --no-verify is not allowed. Fix the underlying issue instead of bypassing hooks." >&2
  exit 2
fi

# Block --force on push (can overwrite remote history)
# Allow --force-with-lease (safe: only overwrites if no one else pushed)
if echo "$COMMAND" | grep -q 'git push.*--force' && ! echo "$COMMAND" | grep -q -- '--force-with-lease'; then
  echo "BLOCKED: --force push requires explicit user approval. Use --force-with-lease instead." >&2
  exit 2
fi

# Block git reset --hard (can destroy uncommitted work)
if echo "$COMMAND" | grep -q 'git reset.*--hard'; then
  echo "BLOCKED: git reset --hard requires explicit user approval." >&2
  exit 2
fi

# Block rm -rf on non-build directories
if echo "$COMMAND" | grep -qP 'rm\s+-rf\s+(?!node_modules|dist|build|\.next|\.cache)'; then
  echo "BLOCKED: rm -rf on non-build directories requires explicit user approval." >&2
  exit 2
fi

exit 0
