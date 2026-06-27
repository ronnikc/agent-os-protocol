#!/bin/bash
# agent-os/scripts/hooks/pre-compact-save.sh
# PreCompact / Stop hook — saves critical session state before context compaction.
# State is restored by session-context-hook.sh at the next SessionStart.
#
# Inspired by PAI's PreCompact/PostCompact relay pattern.
# Sprint 38.5.0 — Phase 4: Context Preservation
#
# This hook should be triggered by PreCompact if available, or Stop as fallback.
# Exit codes: 0 always (never block)

set -uo pipefail

# ── Paths ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OBS_FILE="$REPO_ROOT/agent-os/observations/current-session.jsonl"
SHARED_SUMMARY="$REPO_ROOT/agent-os/shared-memory/summary.md"
SPRINT_COUNT_FILE="/tmp/agent-os-sprint-count-${CLAUDE_SESSION_ID:-${PPID:-$$}}.txt"

SESSION_ID="${CLAUDE_SESSION_ID:-${PPID:-$$}}"
COMPACT_STATE_FILE="/tmp/agent-os-compact-state-${SESSION_ID}.json"

# ── Gather state from observations ──
SPRINT=""
LAST_TASKS=""
CURRENT_TASK=""
FILES_IN_PROGRESS=""
SPRINT_COUNT="0"

# Read sprint count
if [ -f "$SPRINT_COUNT_FILE" ]; then
  SPRINT_COUNT=$(cat "$SPRINT_COUNT_FILE" 2>/dev/null || echo "0")
fi

if [ -f "$OBS_FILE" ] && [ -s "$OBS_FILE" ]; then
  # Get current sprint
  SPRINT=$(grep -oP '"sprint"\s*:\s*"([^"]*)"' "$OBS_FILE" 2>/dev/null | \
    tail -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")

  # Get last 3 decision titles as completed tasks
  LAST_TASKS=$(grep '"type":"decision"' "$OBS_FILE" 2>/dev/null | \
    tail -3 | grep -oP '"title"\s*:\s*"([^"]*)"' | \
    sed 's/.*"\([^"]*\)"$/\1/' | \
    while IFS= read -r line; do echo "  - $line"; done || true)

  # Get last change as current task
  CURRENT_TASK=$(grep '"type":"change"' "$OBS_FILE" 2>/dev/null | \
    tail -1 | grep -oP '"title"\s*:\s*"([^"]*)"' | \
    sed 's/.*"\([^"]*\)"$/\1/' || echo "")

  # Get recently modified files
  FILES_IN_PROGRESS=$(grep -oP '"files_modified"\s*:\s*"([^"]*)"' "$OBS_FILE" 2>/dev/null | \
    tail -5 | sed 's/.*"\([^"]*\)"$/\1/' | grep -v '^$' | sort -u | \
    while IFS= read -r f; do [ -n "$f" ] && echo "  - $f"; done || true)
fi

# ── Get shared memory summary (if exists) ──
TEAM_SUMMARY=""
if [ -f "$SHARED_SUMMARY" ] && [ -s "$SHARED_SUMMARY" ]; then
  TEAM_SUMMARY=$(head -20 "$SHARED_SUMMARY" 2>/dev/null || true)
fi

# ── Build state document ──
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown")

cat > "$COMPACT_STATE_FILE" <<STATE
**Sprint:** ${SPRINT:-unknown}
**Sprint count this session:** ${SPRINT_COUNT}/5
**Saved at:** ${TIMESTAMP}

**Last completed tasks:**
${LAST_TASKS:-  (none recorded)}

**Current task:** ${CURRENT_TASK:-unknown}

**Files in progress:**
${FILES_IN_PROGRESS:-  (none recorded)}

**Team status:**
${TEAM_SUMMARY:-  (no shared memory data)}
STATE

exit 0
