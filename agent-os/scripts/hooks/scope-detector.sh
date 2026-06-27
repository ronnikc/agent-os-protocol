#!/bin/bash
# agent-os/scripts/hooks/scope-detector.sh
# Shared utility: determines if staged changes touch production code.
# Returns scope classification via stdout. Used by other hooks to decide
# whether to enforce full production rules or allow lightweight process.
#
# Output (stdout): One of:
#   "production"  — src/ files staged (full rules apply)
#   "agent-os"    — only agent-os/ files staged (lightweight)
#   "docs"        — only docs/ files staged (lightweight)
#   "tooling"     — only agent-os/ + docs/ (lightweight)
#   "mixed"       — src/ + other files (full rules apply)
#   "none"        — no files staged
#
# Usage from other hooks:
#   SCOPE=$(bash agent-os/scripts/hooks/scope-detector.sh)
#   if [ "$SCOPE" = "production" ] || [ "$SCOPE" = "mixed" ]; then
#     # enforce full rules
#   fi

set -euo pipefail

STAGED=$(git diff --cached --name-only 2>/dev/null || true)

if [ -z "$STAGED" ]; then
  echo "none"
  exit 0
fi

HAS_SRC=false
HAS_AGENT_OS=false
HAS_DOCS=false
HAS_OTHER=false

while IFS= read -r file; do
  case "$file" in
    src/*) HAS_SRC=true ;;
    agent-os/*) HAS_AGENT_OS=true ;;
    docs/*) HAS_DOCS=true ;;
    e2e/*) HAS_SRC=true ;; # e2e tests = production scope
    .github/*) HAS_OTHER=true ;;
    package*.json) HAS_SRC=true ;; # dependency changes = production
    *) HAS_OTHER=true ;;
  esac
done <<< "$STAGED"

if [ "$HAS_SRC" = true ]; then
  if [ "$HAS_AGENT_OS" = true ] || [ "$HAS_DOCS" = true ] || [ "$HAS_OTHER" = true ]; then
    echo "mixed"
  else
    echo "production"
  fi
elif [ "$HAS_AGENT_OS" = true ] && [ "$HAS_DOCS" = false ] && [ "$HAS_OTHER" = false ]; then
  echo "agent-os"
elif [ "$HAS_DOCS" = true ] && [ "$HAS_AGENT_OS" = false ] && [ "$HAS_OTHER" = false ]; then
  echo "docs"
elif [ "$HAS_AGENT_OS" = true ] && [ "$HAS_DOCS" = true ] && [ "$HAS_OTHER" = false ]; then
  echo "tooling"
else
  # Other files only (README.md, .gitignore, etc.) — treat as lightweight
  echo "tooling"
fi
