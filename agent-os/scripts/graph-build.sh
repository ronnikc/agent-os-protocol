#!/bin/bash
# agent-os/scripts/graph-build.sh
# Build the full codebase dependency graph from scratch.
# Scans src/ for TypeScript imports/exports, builds an adjacency list,
# and writes results to agent-os/graph.json for agent consumption.
#
# Usage: bash agent-os/scripts/graph-build.sh [<src-dir>] [<output-path>]
# Dependencies: grep, jq (required for valid JSON output)

set -euo pipefail

SRC_DIR="${1:-src}"
OUTPUT="${2:-agent-os/graph.json}"

if [ ! -d "$SRC_DIR" ]; then
  echo "ERROR: Source directory '$SRC_DIR' not found" >&2
  exit 1
fi

# Verify jq is available
if ! command -v jq &> /dev/null; then
  echo "ERROR: jq is required for JSON output. Install with: apt-get install jq" >&2
  exit 1
fi

echo "Building dependency graph from $SRC_DIR..."

# Count files
TOTAL=$(find "$SRC_DIR" -name "*.ts" -o -name "*.tsx" | grep -v node_modules | grep -v __tests__ | wc -l)
echo "Found $TOTAL source files"

# Build graph as a JSON object using jq for proper escaping
TMPFILE=$(mktemp)
echo "{}" > "$TMPFILE"

while IFS= read -r file; do
  # Extract import paths (relative and package)
  IMPORTS=$(grep -oP "from ['\"]([^'\"]+)['\"]" "$file" 2>/dev/null | sed "s/from ['\"]//;s/['\"]$//" | sort -u || true)

  if [ -n "$IMPORTS" ]; then
    # Convert imports to a JSON array using jq
    IMPORTS_JSON=$(echo "$IMPORTS" | jq -R -s 'split("\n") | map(select(length > 0))')
    # Add entry to graph with proper escaping
    jq --arg key "$file" --argjson val "$IMPORTS_JSON" '. + {($key): $val}' "$TMPFILE" > "${TMPFILE}.new"
    mv "${TMPFILE}.new" "$TMPFILE"
  fi
done < <(find "$SRC_DIR" -name "*.ts" -o -name "*.tsx" | grep -v node_modules | grep -v __tests__ | sort)

# Write output (pretty-printed)
mv "$TMPFILE" "$OUTPUT"

# Summary
NODES=$(jq 'keys | length' "$OUTPUT")
EDGES=$(jq '[.[] | length] | add // 0' "$OUTPUT")
echo "Graph built: $NODES nodes, $EDGES edges"
echo "Output: $OUTPUT"
