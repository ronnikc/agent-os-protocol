#!/bin/bash
# agent-os/scripts/graph-query.sh
# Query the dependency graph for a specific file or module.
# Returns: direct dependents, transitive dependents, import chain.
#
# Usage: bash agent-os/scripts/graph-query.sh <file-or-module-pattern>
# Example: bash agent-os/scripts/graph-query.sh "src/shared/src/types/tasks.ts"
# Example: bash agent-os/scripts/graph-query.sh "permissions"
# Dependencies: grep

set -euo pipefail

TARGET="${1:?Usage: graph-query.sh <file-or-module-pattern>}"
SRC_DIR="${2:-src}"

echo "=== Dependency Query: $TARGET ==="
echo ""

# 1. Direct importers — files that import from the target
echo "--- Direct Importers ---"
DIRECT=$(grep -rl "from.*['\"].*${TARGET}['\"]" "$SRC_DIR" --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v __tests__ | sort || true)

if [ -z "$DIRECT" ]; then
  echo "  (none found)"
else
  DIRECT_COUNT=$(echo "$DIRECT" | wc -l)
  echo "  Found $DIRECT_COUNT direct importers:"
  echo "$DIRECT" | while read -r f; do
    echo "  - $f"
  done
fi

echo ""

# 2. What the target imports (dependencies)
echo "--- Target Dependencies ---"
if [ -f "$TARGET" ]; then
  DEPS=$(grep -oP "from ['\"]([^'\"]+)['\"]" "$TARGET" 2>/dev/null | sed "s/from ['\"]//;s/['\"]$//" | sort -u || true)
  if [ -z "$DEPS" ]; then
    echo "  (no imports)"
  else
    echo "$DEPS" | while read -r dep; do
      echo "  - $dep"
    done
  fi
else
  # Target is a pattern, find matching files first
  MATCHES=$(find "$SRC_DIR" -path "*${TARGET}*" -name "*.ts" -o -path "*${TARGET}*" -name "*.tsx" 2>/dev/null | grep -v node_modules | head -10 || true)
  if [ -z "$MATCHES" ]; then
    echo "  (target file not found — searched as pattern)"
  else
    echo "  Matching files:"
    echo "$MATCHES" | while read -r m; do
      echo "  - $m"
    done
  fi
fi

echo ""

# 3. Transitive impact (2nd-level importers)
echo "--- Transitive Importers (2nd level) ---"
if [ -n "$DIRECT" ]; then
  TRANSITIVE_COUNT=0
  echo "$DIRECT" | while read -r importer; do
    BASENAME=$(basename "$importer" | sed 's/\.[^.]*$//')
    SECOND_LEVEL=$(grep -rl "from.*['\"].*${BASENAME}['\"]" "$SRC_DIR" --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v __tests__ | grep -v "$importer" | sort || true)
    if [ -n "$SECOND_LEVEL" ]; then
      echo "  via $importer:"
      echo "$SECOND_LEVEL" | while read -r s; do
        echo "    - $s"
      done
    fi
  done
else
  echo "  (no direct importers, skipping transitive)"
fi

echo ""
echo "=== Query Complete ==="
