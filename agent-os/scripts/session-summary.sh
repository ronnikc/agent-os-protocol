#!/bin/bash
# agent-os/scripts/session-summary.sh
# Stop hook — generates session summary from observations and archives the session.
#
# Inspired by PAI's session summary worker + claude-mem's automatic summaries.
# Sprint 38.5.0 — Phase 2: Automatic Observations
#
# Exit codes: 0 always (never block session shutdown)

set -uo pipefail

# ── Paths ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OBS_DIR="$REPO_ROOT/agent-os/observations"
OBS_FILE="$OBS_DIR/current-session.jsonl"
INDEX_FILE="$OBS_DIR/index.md"
ARCHIVE_DIR="$OBS_DIR/archive"

# ── Check if there are observations to summarize ──
if [ ! -f "$OBS_FILE" ] || [ ! -s "$OBS_FILE" ]; then
  exit 0
fi

OBS_COUNT=$(wc -l < "$OBS_FILE" 2>/dev/null || echo "0")
if [ "$OBS_COUNT" -eq 0 ] 2>/dev/null; then
  exit 0
fi

# ── Generate summary ──
TODAY=$(date -u +"%Y-%m-%d" 2>/dev/null || echo "unknown")
NOW=$(date -u +"%H:%M UTC" 2>/dev/null || echo "unknown")
SESSION_ID="${CLAUDE_SESSION_ID:-${PPID:-$$}}"

# Count by type. `grep -c` prints "0" on no-match AND exits 1 — if we used
# `|| echo "0"` the subshell would concatenate both "0"s, yielding "0\n0"
# which breaks every downstream numeric test (observed 2026-04-17: the
# bookkeeping-session guard below silently failed because `[ "0\n0" -eq 0 ]`
# errors out). `|| true` keeps the clean "0" grep already printed.
DECISIONS=$(grep -c '"type":"decision"' "$OBS_FILE" 2>/dev/null || true)
CHANGES=$(grep -c '"type":"change"' "$OBS_FILE" 2>/dev/null || true)
DISCOVERIES=$(grep -c '"type":"discovery"' "$OBS_FILE" 2>/dev/null || true)
GATE_CHECKS=$(grep -c '"type":"gate-check"' "$OBS_FILE" 2>/dev/null || true)
DECISIONS=${DECISIONS:-0}
CHANGES=${CHANGES:-0}
DISCOVERIES=${DISCOVERIES:-0}
GATE_CHECKS=${GATE_CHECKS:-0}

# Skip bookkeeping-only sessions to prevent a Stop-hook recursion loop: when a
# session does nothing but commit+push a prior session's work, every run
# appends a new entry that itself becomes the next session's uncommitted
# change. A session only earns an index entry if it has real work —
# changes, discoveries, or gate checks. Pure git-decision sessions are silent.
if [ "$CHANGES" -eq 0 ] 2>/dev/null && \
   [ "$DISCOVERIES" -eq 0 ] 2>/dev/null && \
   [ "$GATE_CHECKS" -eq 0 ] 2>/dev/null; then
  # Still archive the raw observations for trace, but don't pollute index.md.
  mkdir -p "$ARCHIVE_DIR" 2>/dev/null || true
  ARCHIVE_FILE="$ARCHIVE_DIR/${TODAY}-${SESSION_ID:0:8}.jsonl"
  cat "$OBS_FILE" >> "$ARCHIVE_FILE" 2>/dev/null || true
  > "$OBS_FILE" 2>/dev/null || true
  exit 0
fi

# Extract unique files modified
FILES_MOD=$(grep -oP '"files_modified"\s*:\s*"([^"]*)"' "$OBS_FILE" 2>/dev/null | \
  sed 's/.*"\([^"]*\)"$/\1/' | grep -v '^$' | sort -u | head -10 || true)

# Extract sprint if present
SPRINT=$(grep -oP '"sprint"\s*:\s*"([^"]*)"' "$OBS_FILE" 2>/dev/null | \
  tail -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "unknown")

# Get last few decision titles
LAST_DECISIONS=$(grep '"type":"decision"' "$OBS_FILE" 2>/dev/null | \
  tail -5 | grep -oP '"title"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)

# ── Append to index.md ──
{
  echo ""
  echo "### Session ${SESSION_ID:0:8} — ${TODAY} ${NOW}"
  echo ""
  echo "- **Sprint:** ${SPRINT}"
  echo "- **Observations:** ${OBS_COUNT} total (${DECISIONS} decisions, ${CHANGES} changes, ${DISCOVERIES} discoveries, ${GATE_CHECKS} gate checks)"

  if [ -n "$FILES_MOD" ]; then
    echo "- **Files modified:**"
    echo "$FILES_MOD" | while IFS= read -r f; do
      [ -n "$f" ] && echo "  - \`${f}\`"
    done
  fi

  if [ -n "$LAST_DECISIONS" ]; then
    echo "- **Key decisions:**"
    echo "$LAST_DECISIONS" | while IFS= read -r d; do
      [ -n "$d" ] && echo "  - ${d}"
    done
  fi
} >> "$INDEX_FILE" 2>/dev/null || true

# ── Archive session observations ──
mkdir -p "$ARCHIVE_DIR" 2>/dev/null || true
ARCHIVE_FILE="$ARCHIVE_DIR/${TODAY}-${SESSION_ID:0:8}.jsonl"

# Append to daily archive (multiple sessions per day possible)
cat "$OBS_FILE" >> "$ARCHIVE_FILE" 2>/dev/null || true

# Clear current session file for next session
> "$OBS_FILE" 2>/dev/null || true

exit 0
