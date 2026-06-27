#!/bin/bash
# agent-os/scripts/hooks/observation-capture-hook.sh
# PostToolUse hook — automatically classifies tool calls into structured observations.
# No AI, pure bash classification (<50ms). Captures decisions, changes, discoveries, gate results.
#
# Inspired by PAI Knowledge OS automatic observation capture + claude-mem observation types.
# Sprint 38.5.0 — Phase 2: Automatic Observations
#
# Hook contract: reads tool_use JSON from stdin, appends observation to JSONL file.
# Exit codes: 0 always (never block session)

set -uo pipefail

# ── Paths ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OBS_DIR="$REPO_ROOT/agent-os/observations"
OBS_FILE="$OBS_DIR/current-session.jsonl"
DEDUP_FILE="/tmp/agent-os-obs-dedup-${PPID:-$$}.txt"

# Ensure directory exists
mkdir -p "$OBS_DIR" 2>/dev/null || true

# ── Read tool use data from stdin ──
INPUT=""
if [ ! -t 0 ]; then
  INPUT=$(timeout 1 cat 2>/dev/null || true)
fi

if [ -z "$INPUT" ]; then
  exit 0
fi

# ── Extract fields from JSON input ──
# Claude Code hook sends: { "tool_name": "...", "tool_input": { ... }, "tool_result": "..." }
TOOL_NAME=$(echo "$INPUT" | grep -oP '"tool_name"\s*:\s*"([^"]*)"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
TOOL_INPUT=$(echo "$INPUT" | grep -oP '"tool_input"\s*:\s*\{[^}]*\}' | head -1 || true)

if [ -z "$TOOL_NAME" ]; then
  exit 0
fi

# ── Extract file paths from tool input ──
FILE_PATH=$(echo "$TOOL_INPUT" | grep -oP '"(file_path|path|command)"\s*:\s*"([^"]*)"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)

# ── Classify observation type ──
OBS_TYPE=""
OBS_TITLE=""
SPRINT=""
FILES_MOD=""
FILES_READ=""

case "$TOOL_NAME" in
  Bash)
    COMMAND=$(echo "$TOOL_INPUT" | grep -oP '"command"\s*:\s*"([^"]*)"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)

    if echo "$COMMAND" | grep -qE '^git commit' 2>/dev/null; then
      OBS_TYPE="decision"
      COMMIT_MSG=$(echo "$COMMAND" | grep -oP -- '-m\s+"([^"]*)"' | head -1 | sed 's/-m\s*"//;s/"$//' || echo "commit")
      OBS_TITLE="git commit: ${COMMIT_MSG:0:80}"
    elif echo "$COMMAND" | grep -qE '(vitest|npm.*test|npm run test)' 2>/dev/null; then
      OBS_TYPE="gate-check"
      OBS_TITLE="Test run: ${COMMAND:0:80}"
    elif echo "$COMMAND" | grep -qE 'npx tsc' 2>/dev/null; then
      OBS_TYPE="gate-check"
      OBS_TITLE="Type-check: ${COMMAND:0:80}"
    elif echo "$COMMAND" | grep -qE '(npm run build|vite build)' 2>/dev/null; then
      OBS_TYPE="gate-check"
      OBS_TITLE="Build: ${COMMAND:0:80}"
    elif echo "$COMMAND" | grep -qE 'graph-(query|impact|build|update)' 2>/dev/null; then
      OBS_TYPE="discovery"
      OBS_TITLE="Graph query: ${COMMAND:0:80}"
    elif echo "$COMMAND" | grep -qE '^git push' 2>/dev/null; then
      OBS_TYPE="decision"
      OBS_TITLE="git push: ${COMMAND:0:80}"
    elif echo "$COMMAND" | grep -qE 'sprint-gate-runner|lint-sprint|lint-housekeeping|check-i18n' 2>/dev/null; then
      OBS_TYPE="gate-check"
      OBS_TITLE="Gate check: ${COMMAND:0:80}"
    else
      # Skip mundane commands (ls, cat, echo, etc.)
      exit 0
    fi
    ;;
  Edit)
    OBS_TYPE="change"
    OBS_TITLE="Edit: ${FILE_PATH:0:100}"
    FILES_MOD="$FILE_PATH"
    ;;
  Write)
    OBS_TYPE="change"
    OBS_TITLE="Write: ${FILE_PATH:0:100}"
    FILES_MOD="$FILE_PATH"
    ;;
  Read)
    OBS_TYPE="discovery"
    OBS_TITLE="Read: ${FILE_PATH:0:100}"
    FILES_READ="$FILE_PATH"
    ;;
  Grep)
    OBS_TYPE="discovery"
    PATTERN=$(echo "$TOOL_INPUT" | grep -oP '"pattern"\s*:\s*"([^"]*)"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
    OBS_TITLE="Search: ${PATTERN:0:60} in ${FILE_PATH:0:40}"
    ;;
  Glob)
    OBS_TYPE="discovery"
    PATTERN=$(echo "$TOOL_INPUT" | grep -oP '"pattern"\s*:\s*"([^"]*)"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
    OBS_TITLE="Glob: ${PATTERN:0:100}"
    ;;
  *)
    # Skip tools we don't track (Agent, TodoWrite, etc.)
    exit 0
    ;;
esac

if [ -z "$OBS_TYPE" ] || [ -z "$OBS_TITLE" ]; then
  exit 0
fi

# ── Deduplication (30-second window) ──
DEDUP_KEY="${TOOL_NAME}:${FILE_PATH}:${OBS_TYPE}"
NOW=$(date +%s 2>/dev/null || echo "0")

if [ -f "$DEDUP_FILE" ]; then
  LAST_ENTRY=$(grep -F "$DEDUP_KEY" "$DEDUP_FILE" 2>/dev/null | tail -1 || true)
  if [ -n "$LAST_ENTRY" ]; then
    LAST_TIME=$(echo "$LAST_ENTRY" | cut -d'|' -f1)
    ELAPSED=$((NOW - LAST_TIME))
    if [ "$ELAPSED" -lt 30 ] 2>/dev/null; then
      exit 0
    fi
  fi
fi

# Update dedup file
echo "${NOW}|${DEDUP_KEY}" >> "$DEDUP_FILE" 2>/dev/null || true
# Keep dedup file small (last 100 entries)
if [ -f "$DEDUP_FILE" ]; then
  tail -100 "$DEDUP_FILE" > "${DEDUP_FILE}.tmp" 2>/dev/null && mv "${DEDUP_FILE}.tmp" "$DEDUP_FILE" 2>/dev/null || true
fi

# ── Build observation JSON ──
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown")
SESSION_ID="${CLAUDE_SESSION_ID:-${PPID:-$$}}"
OBS_ID="obs-$(date +%Y%m%d%H%M%S)-$$"

# Detect current sprint from recent observations or environment
if [ -z "$SPRINT" ]; then
  SPRINT=$(grep -oP '"sprint"\s*:\s*"([^"]*)"' "$OBS_FILE" 2>/dev/null | tail -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")
fi

# Escape strings for JSON (basic: replace " with \", newlines with space)
OBS_TITLE_ESC=$(echo "$OBS_TITLE" | sed 's/"/\\"/g' | tr '\n' ' ')
FILES_MOD_ESC=$(echo "$FILES_MOD" | sed 's/"/\\"/g')
FILES_READ_ESC=$(echo "$FILES_READ" | sed 's/"/\\"/g')

# Write JSONL line
echo "{\"id\":\"${OBS_ID}\",\"timestamp\":\"${TIMESTAMP}\",\"session_id\":\"${SESSION_ID}\",\"type\":\"${OBS_TYPE}\",\"title\":\"${OBS_TITLE_ESC}\",\"tool\":\"${TOOL_NAME}\",\"files_modified\":\"${FILES_MOD_ESC}\",\"files_read\":\"${FILES_READ_ESC}\",\"sprint\":\"${SPRINT}\"}" >> "$OBS_FILE" 2>/dev/null || true

exit 0
