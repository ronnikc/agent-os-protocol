#!/bin/bash
# agent-os/scripts/hooks/post-edit-typecheck.sh
# PostToolUse hook: After editing a TypeScript file, run incremental type-check.
# Catches type errors immediately instead of discovering them at commit time.
#
# Input: JSON via stdin from Claude Code hook system
#   { "tool_name": "Edit", "tool_input": { "file_path": "..." }, ... }
# Exit: 0 = pass (or non-TS file), 2 = type errors found

set -euo pipefail

# Read JSON from stdin, extract the file path
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# If we can't extract the path, allow
if [ -z "$FILE" ]; then
  exit 0
fi

# Only check TypeScript files
if [[ ! "$FILE" =~ \.(ts|tsx)$ ]]; then
  exit 0
fi

# Determine which tsconfig to use
if [[ "$FILE" == *src/shared/* ]]; then
  TSCONFIG="src/shared/tsconfig.json"
elif [[ "$FILE" == *src/backend/* ]]; then
  TSCONFIG="src/backend/tsconfig.json"
elif [[ "$FILE" == *src/frontend/* ]]; then
  TSCONFIG="src/frontend/tsconfig.json"
else
  exit 0
fi

# Run incremental type-check (noEmit for speed)
if ! npx tsc -p "$TSCONFIG" --noEmit 2>/dev/null; then
  echo "TYPE ERROR after editing $FILE. Check: npx tsc -p $TSCONFIG --noEmit" >&2
  # Exit 0, not 2 — type errors are warnings, not blocks on PostToolUse
  # The developer should fix them but we don't block the edit retroactively
  exit 0
fi

exit 0
