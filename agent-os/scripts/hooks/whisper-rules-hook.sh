#!/bin/bash
# agent-os/scripts/hooks/whisper-rules-hook.sh
# UserPromptSubmit hook — injects whisper rules ONCE PER HOUR per session.
# Rules survive context compaction, /clear, and session restarts.
#
# Originally (Sprint 38.5.0) this injected on EVERY prompt, which produced
# ~100KB of duplicate context over a long session and contributed to the
# interrupt-loop stall pattern documented in the 2026-04-11 retrospective.
# The current behaviour fires the full rules block once, then silently
# no-ops for subsequent prompts within the same hour (or same session PID,
# whichever expires later).
#
# To force a re-emit during a running session, delete the stamp file:
#   rm /tmp/agent-os-whisper-stamp-<PID>
#
# Exit codes:
#   0 — always (never block the session)

set -uo pipefail

# ── Paths ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WHISPER_FILE="$REPO_ROOT/agent-os/whisper-rules.md"

# ── Once-per-hour guard ──
# Stamp file keyed on parent PID (Claude Code session). Re-emits after
# 3600 seconds even within the same session, so long-running sessions
# still see the rules periodically.
STAMP_FILE="/tmp/agent-os-whisper-stamp-${PPID:-$$}"
NOW=$(date +%s 2>/dev/null || echo 0)
REEMIT_AFTER=3600  # 1 hour

if [ -f "$STAMP_FILE" ]; then
  LAST=$(cat "$STAMP_FILE" 2>/dev/null || echo 0)
  ELAPSED=$(( NOW - LAST ))
  if [ "$ELAPSED" -lt "$REEMIT_AFTER" ] 2>/dev/null; then
    # Silent no-op — rules are already in context from an earlier prompt
    # in this session within the last hour.
    exit 0
  fi
fi

# ── Read whisper rules ──
if [ ! -f "$WHISPER_FILE" ]; then
  exit 0
fi

RULES=$(cat "$WHISPER_FILE" 2>/dev/null || true)

if [ -z "$RULES" ]; then
  exit 0
fi

# ── Output to stdout (Claude Code injects as context) ──
echo "$RULES"

# ── Update stamp ──
echo "$NOW" > "$STAMP_FILE" 2>/dev/null || true

exit 0
