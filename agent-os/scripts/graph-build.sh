#!/bin/bash
# agent-os/scripts/graph-build.sh
# Build the full codebase dependency graph from scratch.
# Scans src/ for TypeScript imports/exports, builds an adjacency list,
# and writes results to agent-os/graph.json for agent consumption.
#
# Usage: bash agent-os/scripts/graph-build.sh [<src-dir>] [<output-path>]
# Dependencies: grep, jq (required for valid JSON output)

set -euo pipefail

SRC_ARG="${1:-}"
OUTPUT="${2:-agent-os/graph.json}"

# Source roots. Agent OS Protocol is a monorepo with no top-level src/ — code lives
# under packages/*/src, apps/*, agent-os-panel/, and agent-os/scripts. When a root is
# passed explicitly, use only that; otherwise scan the repo's real source roots that exist.
if [ -n "$SRC_ARG" ]; then
  if [ ! -d "$SRC_ARG" ]; then
    echo "ERROR: Source directory '$SRC_ARG' not found" >&2
    exit 1
  fi
  ROOTS=("$SRC_ARG")
else
  ROOTS=()
  for r in packages apps agent-os-panel agent-os/scripts; do
    [ -d "$r" ] && ROOTS+=("$r")
  done
  if [ ${#ROOTS[@]} -eq 0 ]; then
    echo "ERROR: no source roots found (looked for packages/ apps/ agent-os-panel/ agent-os/scripts)" >&2
    exit 1
  fi
fi

# Verify jq is available
if ! command -v jq &> /dev/null; then
  echo "ERROR: jq is required for JSON output. Install with: apt-get install jq" >&2
  exit 1
fi

# Find source files (TS + JS/MJS, the panel/apps are vanilla JS) across all roots,
# excluding vendored, build, and test files.
find_sources() {
  find "${ROOTS[@]}" \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.mjs" \) 2>/dev/null \
    | grep -vE 'node_modules|/dist/|/__tests__/|\.test\.[cm]?tsx?$|\.min\.js$'
}

echo "Building dependency graph from: ${ROOTS[*]}"

# Count files
TOTAL=$(find_sources | wc -l)
echo "Found $TOTAL source files"

# Build graph as a JSON object using jq for proper escaping
TMPFILE=$(mktemp)
echo "{}" > "$TMPFILE"

while IFS= read -r file; do
  # Extract import paths (ESM `from '...'` and CommonJS/dynamic `require('...')`/`import('...')`).
  IMPORTS=$( { grep -oP "from ['\"]([^'\"]+)['\"]" "$file" 2>/dev/null | sed "s/from ['\"]//;s/['\"]$//"; \
               grep -oP "(?:require|import)\(\s*['\"]([^'\"]+)['\"]" "$file" 2>/dev/null | sed -E "s/.*['\"]//"; } \
             | sort -u || true)

  if [ -n "$IMPORTS" ]; then
    # Convert imports to a JSON array using jq
    IMPORTS_JSON=$(echo "$IMPORTS" | jq -R -s 'split("\n") | map(select(length > 0))')
    # Add entry to graph with proper escaping
    jq --arg key "$file" --argjson val "$IMPORTS_JSON" '. + {($key): $val}' "$TMPFILE" > "${TMPFILE}.new"
    mv "${TMPFILE}.new" "$TMPFILE"
  fi
done < <(find_sources | sort)

# Write output (pretty-printed)
mv "$TMPFILE" "$OUTPUT"

# Summary
NODES=$(jq 'keys | length' "$OUTPUT")
EDGES=$(jq '[.[] | length] | add // 0' "$OUTPUT")
echo "Graph built: $NODES nodes, $EDGES edges"
echo "Output: $OUTPUT"
