#!/bin/bash
# agent-os/scripts/hooks/session-checkpoint.sh
# Stop hook: Save session context for crash recovery.
# Records uncommitted changes, current branch, and recent commits.
#
# Input: JSON via stdin from Claude Code hook system (Stop event)
# Output: agent-os/.session-checkpoint
# Exit: Always 0 (non-blocking — best effort)

# Consume stdin (required even if we don't use it)
cat > /dev/null 2>&1 || true

CHECKPOINT_FILE="agent-os/.session-checkpoint"

{
  echo "=== Session Checkpoint ==="
  echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
  echo ""

  echo "--- Uncommitted Changes ---"
  git status --short 2>/dev/null || echo "(git not available)"
  echo ""

  echo "--- Recent Commits (this session) ---"
  git log --oneline -5 2>/dev/null || echo "(none)"
  echo ""

  echo "--- Modified Files (unstaged) ---"
  git diff --name-only 2>/dev/null || echo "(none)"
  echo ""

  echo "--- Staged Files ---"
  git diff --cached --name-only 2>/dev/null || echo "(none)"
  echo ""

  echo "--- Graph State ---"
  if [ -f "agent-os/.graph-stale" ]; then
    echo "Graph: STALE (needs update)"
    cat "agent-os/.graph-modified-files" 2>/dev/null || echo "(no modified files tracked)"
  else
    echo "Graph: CURRENT"
  fi
  echo ""

  echo "=== Recovery Instructions ==="
  echo "1. Check git status for uncommitted work"
  echo "2. Check git stash list for stashed changes"
  echo "3. If graph is stale: bash agent-os/scripts/graph-update.sh"
  echo "4. Resume from the last completed task in TodoWrite"
} > "$CHECKPOINT_FILE" 2>/dev/null

exit 0
