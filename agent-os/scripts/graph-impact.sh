#!/bin/bash
# agent-os/scripts/graph-impact.sh
# Analyze blast radius for files changed in the current branch.
# Combines graph-query for each changed file and produces a risk summary.
#
# Usage: bash agent-os/scripts/graph-impact.sh [--base <ref>]
# Example: bash agent-os/scripts/graph-impact.sh --base main
# Dependencies: git, grep

set -euo pipefail

BASE="${1:-main}"
SRC_DIR="src"

echo "=== Blast Radius Analysis (vs $BASE) ==="
echo ""

# Get changed files
CHANGED=$(git diff --name-only "$BASE" -- '*.ts' '*.tsx' 2>/dev/null | grep -v node_modules || true)

if [ -z "$CHANGED" ]; then
  echo "No TypeScript files changed since $BASE"
  exit 0
fi

CHANGED_COUNT=$(echo "$CHANGED" | wc -l)
echo "Changed files: $CHANGED_COUNT"
echo ""

# Classify changes by risk
HIGH_RISK=0
MEDIUM_RISK=0
LOW_RISK=0
TOTAL_IMPORTERS=0

echo "| File | Risk | Direct Importers | Category |"
echo "|------|------|-----------------|----------|"

for file in $CHANGED; do
  CATEGORY="low"
  IMPORTERS=0

  # Check if file exists (not deleted)
  if [ -f "$file" ]; then
    IMPORTERS=$(grep -rl "$(basename "$file" | sed 's/\.[^.]*$//')" "$SRC_DIR" --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v __tests__ | grep -v "$file" | wc -l || echo 0)
  fi

  # Classify risk
  if echo "$file" | grep -q "src/shared/"; then
    CATEGORY="high"
    HIGH_RISK=$((HIGH_RISK + 1))
  elif echo "$file" | grep -q "app.ts\|routes.ts\|api-client.ts"; then
    CATEGORY="high"
    HIGH_RISK=$((HIGH_RISK + 1))
  elif echo "$file" | grep -q "seed-\|permissions\|constants"; then
    CATEGORY="medium"
    MEDIUM_RISK=$((MEDIUM_RISK + 1))
  else
    if [ "$IMPORTERS" -gt 5 ]; then
      CATEGORY="medium"
      MEDIUM_RISK=$((MEDIUM_RISK + 1))
    else
      LOW_RISK=$((LOW_RISK + 1))
    fi
  fi

  TOTAL_IMPORTERS=$((TOTAL_IMPORTERS + IMPORTERS))
  echo "| $file | $CATEGORY | $IMPORTERS | $(dirname "$file" | sed 's|src/||') |"
done

echo ""
echo "=== Risk Summary ==="
echo "  Changed files: $CHANGED_COUNT"
echo "  Total importers affected: $TOTAL_IMPORTERS"
echo "  High risk: $HIGH_RISK"
echo "  Medium risk: $MEDIUM_RISK"
echo "  Low risk: $LOW_RISK"
echo ""

if [ "$HIGH_RISK" -gt 2 ]; then
  echo "RECOMMENDATION: High blast radius. Consider decomposing this change."
elif [ "$HIGH_RISK" -gt 0 ]; then
  echo "RECOMMENDATION: Proceed with caution. Shared types or configuration changed."
else
  echo "RECOMMENDATION: Low risk. Proceed normally."
fi
