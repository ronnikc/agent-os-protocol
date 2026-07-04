#!/bin/bash
# agent-os/scripts/graph-update.sh
# Incrementally update the dependency graph for changed files only.
# Uses git diff to detect modified files, then re-scans their imports
# and writes the updated entries back into graph.json.
#
# Usage: bash agent-os/scripts/graph-update.sh [--base <ref>] [--output <path>]
# Dependencies: git, grep, jq

set -euo pipefail

BASE="HEAD~1"
OUTPUT="agent-os/graph.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)  BASE="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    *)
      # Legacy positional: first arg = base, second = output
      if [ "$BASE" = "HEAD~1" ]; then BASE="$1"; shift
      elif [ "$OUTPUT" = "agent-os/graph.json" ]; then OUTPUT="$1"; shift
      else echo "Unknown argument: $1" >&2; exit 1; fi
      ;;
  esac
done

if [ ! -f "$OUTPUT" ]; then
  echo "No existing graph found at $OUTPUT — running full build instead"
  bash "$(dirname "$0")/graph-build.sh"
  exit $?
fi

# Verify jq is available
if ! command -v jq &> /dev/null; then
  echo "ERROR: jq is required. Install with: apt-get install jq" >&2
  exit 1
fi

echo "Updating dependency graph (changes since $BASE)..."

# Verify BASE resolves to a real commit that reaches our history. A missing or
# unreachable base was silently treated as "no changes" for months (Task A kept
# reporting empty diffs against sandbox hashes and shallow-clone horizons, see
# `agent-os/scheduled/state/last-graph-update.json` 2026-04-19). Fail loudly.
if ! git cat-file -e "${BASE}^{commit}" 2>/dev/null; then
  # Try to fetch the missing ref in case this is a shallow or partial clone.
  # Use explicit depth so we don't unshallow the whole repo unnecessarily.
  echo "Base $BASE not present locally — attempting fetch..." >&2
  if ! git fetch --depth=500 origin "$BASE" 2>/dev/null; then
    # Final fallback: try unshallowing (older clones may need this)
    git fetch --unshallow 2>/dev/null || true
  fi
fi

if ! git cat-file -e "${BASE}^{commit}" 2>/dev/null; then
  echo "ERROR: base ref $BASE is not resolvable in this clone — cannot compute diff." >&2
  echo "       Check scheduled state file; it may contain a sandbox-branch hash" >&2
  echo "       that never reached origin/main. Rerun with a known-good ref." >&2
  exit 2
fi

# Warn (non-fatal) if BASE isn't an ancestor of HEAD — may indicate an orphan
# sandbox commit. `git diff` still works (compares trees), but the result may
# include files unrelated to the current branch's progression.
if ! git merge-base --is-ancestor "$BASE" HEAD 2>/dev/null; then
  echo "WARNING: base ref $BASE is not an ancestor of HEAD." >&2
  echo "         Diff will compare trees directly; this may not match 'recent merges'." >&2
fi

# Get changed TypeScript files (including deleted ones). Do NOT suppress stderr
# here — a real git error must surface; the `|| true` on the empty-result path
# is safe because we've already validated BASE above.
CHANGED=$(git diff --name-only "$BASE" -- '*.ts' '*.tsx' '*.js' '*.mjs' \
  | { grep -vE 'node_modules|/dist/|/__tests__/|\.test\.[cm]?tsx?$|\.min\.js$' || true; })

if [ -z "$CHANGED" ]; then
  echo "NO_CHANGES: no source files changed since $BASE — graph is current"
  exit 0
fi

COUNT=$(echo "$CHANGED" | wc -l)
echo "Re-scanning $COUNT changed files..."

# Work on a copy of the graph; keep a checksum of the original to detect real changes
TMPFILE=$(mktemp)
cp "$OUTPUT" "$TMPFILE"
ORIGINAL_HASH=$(md5sum "$OUTPUT" | cut -d' ' -f1)

UPDATED=0
REMOVED=0

for file in $CHANGED; do
  if [ -f "$file" ]; then
    # File exists — re-scan its imports (ESM + require/dynamic-import) and update the entry
    IMPORTS=$( { grep -oP "from ['\"]([^'\"]+)['\"]" "$file" 2>/dev/null | sed "s/from ['\"]//;s/['\"]$//"; \
                 grep -oP "(?:require|import)\(\s*['\"]([^'\"]+)['\"]" "$file" 2>/dev/null | sed -E "s/.*['\"]//"; } \
               | sort -u || true)

    if [ -n "$IMPORTS" ]; then
      IMPORTS_JSON=$(echo "$IMPORTS" | jq -R -s 'split("\n") | map(select(length > 0))')
      jq --arg key "$file" --argjson val "$IMPORTS_JSON" '. + {($key): $val}' "$TMPFILE" > "${TMPFILE}.new"
      mv "${TMPFILE}.new" "$TMPFILE"
      echo "  updated: $file"
    else
      # File has no imports — remove its entry if it exists
      jq --arg key "$file" 'del(.[$key])' "$TMPFILE" > "${TMPFILE}.new"
      mv "${TMPFILE}.new" "$TMPFILE"
      echo "  cleared: $file (no imports)"
    fi
    UPDATED=$((UPDATED + 1))
  else
    # File was deleted — remove its entry from the graph
    jq --arg key "$file" 'del(.[$key])' "$TMPFILE" > "${TMPFILE}.new"
    mv "${TMPFILE}.new" "$TMPFILE"
    echo "  removed: $file (deleted)"
    REMOVED=$((REMOVED + 1))
  fi
done

# Check if anything actually changed before overwriting
NEW_HASH=$(md5sum "$TMPFILE" | cut -d' ' -f1)

if [ "$ORIGINAL_HASH" = "$NEW_HASH" ]; then
  rm "$TMPFILE"
  NODES=$(jq 'keys | length' "$OUTPUT")
  EDGES=$(jq '[.[] | length] | add // 0' "$OUTPUT")
  echo "NO_CHANGES: graph content identical after re-scan ($UPDATED files checked)"
  echo "Graph totals: $NODES nodes, $EDGES edges"
  echo "Output: $OUTPUT"
  exit 0
fi

# Write back to output
mv "$TMPFILE" "$OUTPUT"

# Summary
NODES=$(jq 'keys | length' "$OUTPUT")
EDGES=$(jq '[.[] | length] | add // 0' "$OUTPUT")
echo "GRAPH_CHANGED: $UPDATED files re-scanned, $REMOVED deleted entries removed"
echo "Graph totals: $NODES nodes, $EDGES edges"
echo "Output: $OUTPUT"
