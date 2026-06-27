#!/bin/bash
# agent-os/scripts/hooks/graph-sprint-context-hook.sh
# PostToolUse hook (Read matcher) — injects graph intelligence when reading sprint specs.
# Auto-runs graph-impact.sh on files mentioned in the spec to provide blast radius context.
#
# Sprint 38.5.0 — Phase 6: Graph System Activation
# Exit codes: 0 always (never block)

set -uo pipefail

# ── Read tool input from stdin ──
INPUT=""
if [ ! -t 0 ]; then
  INPUT=$(timeout 1 cat 2>/dev/null || true)
fi

if [ -z "$INPUT" ]; then
  exit 0
fi

# ── Extract file path ──
FILE_PATH=$(echo "$INPUT" | grep -oP '"file_path"\s*:\s*"([^"]*)"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# ── Only trigger for sprint spec files ──
if ! echo "$FILE_PATH" | grep -qE '(sprint-[0-9]+\.[0-9]+\.[0-9]+\.md|sprint-.*\.md)' 2>/dev/null; then
  exit 0
fi

# ── Check if graph.json exists ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GRAPH_FILE="$REPO_ROOT/agent-os/graph.json"

if [ ! -f "$GRAPH_FILE" ]; then
  exit 0
fi

# ── Check if jq is available ──
if ! command -v jq &> /dev/null; then
  exit 0
fi

# ── Extract file paths mentioned in the sprint spec ──
# Look for src/ paths in the spec content
SPEC_FILES=""
if [ -f "$FILE_PATH" ]; then
  SPEC_FILES=$(grep -oP 'src/[a-zA-Z0-9_/.-]+\.(ts|tsx)' "$FILE_PATH" 2>/dev/null | sort -u | head -20 || true)
fi

if [ -z "$SPEC_FILES" ]; then
  exit 0
fi

# ── Analyze blast radius for mentioned files ──
HIGH_RISK=""
MEDIUM_RISK=""
TOTAL_IMPORTERS=0
FILE_COUNT=0

while IFS= read -r src_file; do
  [ -z "$src_file" ] && continue
  FILE_COUNT=$((FILE_COUNT + 1))

  # Count importers from graph.json
  BASENAME=$(basename "$src_file" | sed 's/\.[^.]*$//')
  IMPORTERS=$(jq -r "to_entries[] | select(.value[] | contains(\"$BASENAME\")) | .key" "$GRAPH_FILE" 2>/dev/null | wc -l || echo "0")
  TOTAL_IMPORTERS=$((TOTAL_IMPORTERS + IMPORTERS))

  if echo "$src_file" | grep -q "src/shared/" 2>/dev/null; then
    HIGH_RISK="${HIGH_RISK}  - ${src_file} (${IMPORTERS} importers, SHARED = always high risk)\n"
  elif [ "$IMPORTERS" -gt 5 ] 2>/dev/null; then
    HIGH_RISK="${HIGH_RISK}  - ${src_file} (${IMPORTERS} importers)\n"
  elif [ "$IMPORTERS" -gt 2 ] 2>/dev/null; then
    MEDIUM_RISK="${MEDIUM_RISK}  - ${src_file} (${IMPORTERS} importers)\n"
  fi
done <<< "$SPEC_FILES"

# ── Only output if there's meaningful intelligence ──
if [ "$TOTAL_IMPORTERS" -eq 0 ] && [ -z "$HIGH_RISK" ]; then
  exit 0
fi

# ── Output graph intelligence ──
cat <<GRAPH
<agent-os-graph-intelligence>
## Graph Intelligence for Sprint Spec

Files referenced in spec: ${FILE_COUNT}
Total downstream importers affected: ${TOTAL_IMPORTERS}
GRAPH

if [ -n "$HIGH_RISK" ]; then
  echo "**HIGH RISK files (>5 importers or in shared/):**"
  echo -e "$HIGH_RISK"
fi

if [ -n "$MEDIUM_RISK" ]; then
  echo "**MEDIUM RISK files (3-5 importers):**"
  echo -e "$MEDIUM_RISK"
fi

cat <<ADVICE

**Build order reminder (R-01):** shared -> backend -> frontend
**After modifying shared/ types:** type-check ALL three packages
**Review groups:** Files with shared importers should be reviewed together
</agent-os-graph-intelligence>
ADVICE

exit 0
