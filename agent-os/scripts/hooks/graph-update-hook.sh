#!/bin/bash
# agent-os/scripts/hooks/graph-update-hook.sh
# PostToolUse hook: After editing TypeScript files, mark the dependency
# graph as stale so graph-navigator queries stay fresh.
# Also warns when shared/ files are edited (high blast radius).
#
# Input: JSON via stdin from Claude Code hook system
#   { "tool_name": "Edit", "tool_input": { "file_path": "..." }, ... }
# Exit: Always 0 (non-blocking — graph staleness is advisory)
#
# Enhanced in Sprint 38.5.0 — Phase 6: Graph System Activation

# Read JSON from stdin, extract the file path
INPUT=$(cat) || true
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || true

# If we can't extract the path, skip
if [ -z "$FILE" ]; then
  exit 0
fi

# Only track TypeScript source files
if [[ ! "$FILE" =~ \.(ts|tsx)$ ]]; then
  exit 0
fi

# Skip test files (they're not in the dependency graph)
if [[ "$FILE" == *__tests__* ]] || [[ "$FILE" == *.test.* ]] || [[ "$FILE" == *.spec.* ]]; then
  exit 0
fi

# Skip if graph doesn't exist yet
if [ ! -f "agent-os/graph.json" ]; then
  exit 0
fi

# Mark graph as stale (a lightweight flag file)
touch "agent-os/.graph-stale"

# Log the modification for batch update
echo "$FILE" >> "agent-os/.graph-modified-files"

# ── Phase 6 Enhancement: Warn on shared/ file edits ──
if [[ "$FILE" == *src/shared/* ]]; then
  # Count importers if jq is available
  IMPORTERS=0
  BASENAME=$(basename "$FILE" | sed 's/\.[^.]*$//')
  if command -v jq &> /dev/null; then
    IMPORTERS=$(jq -r "to_entries[] | select(.value[] | contains(\"$BASENAME\")) | .key" agent-os/graph.json 2>/dev/null | wc -l || echo "0")
  fi

  cat <<WARNING
<agent-os-graph-warning>
WARNING: You modified a shared/ file: ${FILE}
This file has ${IMPORTERS} downstream importers across backend and frontend.
After completing your changes:
1. Build shared: npx tsc -p src/shared/tsconfig.json
2. Type-check backend: npx tsc -p src/backend/tsconfig.json --noEmit
3. Type-check frontend: npx tsc -p src/frontend/tsconfig.json --noEmit
Shared type changes affect the ENTIRE codebase (R-01, R-11).
</agent-os-graph-warning>
WARNING
fi

exit 0
