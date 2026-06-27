#!/bin/bash
# agent-os/scripts/shared-mem-summary.sh
# Generate a compact markdown summary of all agent states and recent messages.
# Output is written to agent-os/shared-memory/summary.md for injection into agent prompts.
#
# Inspired by open-multi-agent's SharedMemory.getSummary() pattern.
# Sprint 38.5.0 — Phase 3: Shared Memory Bus
#
# Usage: bash agent-os/scripts/shared-mem-summary.sh [--stdout]
# Default: writes to summary.md. With --stdout: prints to stdout only.

set -euo pipefail

OUTPUT_MODE="${1:-file}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="$REPO_ROOT/agent-os/shared-memory/state"
BUS_FILE="$REPO_ROOT/agent-os/shared-memory/bus.jsonl"
SUMMARY_FILE="$REPO_ROOT/agent-os/shared-memory/summary.md"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown")

# ── Build summary ──
SUMMARY="## Shared Team Memory (auto-generated ${TIMESTAMP})
"

# ── Agent states ──
AGENT_COUNT=0
if [ -d "$STATE_DIR" ]; then
  for STATE_FILE in "$STATE_DIR"/*.json; do
    [ -f "$STATE_FILE" ] || continue
    AGENT_NAME=$(basename "$STATE_FILE" .json)
    # Skip internal files
    [ "$AGENT_NAME" = "panel-processes" ] && continue
    echo "$AGENT_NAME" | grep -q "^\.read-state" && continue

    AGENT_COUNT=$((AGENT_COUNT + 1))

    # Extract key fields
    if command -v jq &> /dev/null; then
      STATUS=$(jq -r '.status // "unknown"' "$STATE_FILE" 2>/dev/null || echo "unknown")
      TASK=$(jq -r '.task // "unknown"' "$STATE_FILE" 2>/dev/null || echo "unknown")
      UPDATED=$(jq -r '.updated_at // "unknown"' "$STATE_FILE" 2>/dev/null || echo "unknown")

      SUMMARY="${SUMMARY}
### ${AGENT_NAME} (${STATUS}, updated ${UPDATED})
"
      # Add all non-meta fields as bullet points
      FIELDS=$(jq -r 'to_entries[] | select(.key != "agent" and .key != "updated_at" and .key != "status" and .key != "task") | "- **\(.key):** \(.value | tostring | .[0:200])"' "$STATE_FILE" 2>/dev/null || true)
      if [ -n "$TASK" ] && [ "$TASK" != "unknown" ]; then
        SUMMARY="${SUMMARY}- **Task:** ${TASK}
"
      fi
      if [ -n "$FIELDS" ]; then
        SUMMARY="${SUMMARY}${FIELDS}
"
      fi
    else
      # Fallback without jq: just show raw JSON (truncated)
      CONTENT=$(head -c 500 "$STATE_FILE" 2>/dev/null || true)
      SUMMARY="${SUMMARY}
### ${AGENT_NAME}
\`\`\`json
${CONTENT}
\`\`\`
"
    fi
  done
fi

if [ "$AGENT_COUNT" -eq 0 ]; then
  SUMMARY="${SUMMARY}
(no agent states recorded yet)
"
fi

# ── Recent messages (last 10) ──
if [ -f "$BUS_FILE" ] && [ -s "$BUS_FILE" ]; then
  MSG_COUNT=$(wc -l < "$BUS_FILE" 2>/dev/null || echo "0")
  SUMMARY="${SUMMARY}
### Recent Messages (${MSG_COUNT} total, showing last 10)
"
  RECENT_MSGS=$(tail -10 "$BUS_FILE" 2>/dev/null | while IFS= read -r line; do
    [ -z "$line" ] && continue
    TS=$(echo "$line" | grep -oP '"timestamp"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' | grep -oP '\d{2}:\d{2}' | head -1 || echo "??:??")
    FROM=$(echo "$line" | grep -oP '"from"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
    TO=$(echo "$line" | grep -oP '"to"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
    TYPE=$(echo "$line" | grep -oP '"type"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
    CONTENT=$(echo "$line" | grep -oP '"content"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
    echo "- ${TS} **${FROM}**->${TO} [${TYPE}]: ${CONTENT:0:100}"
  done || true)

  SUMMARY="${SUMMARY}${RECENT_MSGS}
"
fi

# ── Output ──
if [ "$OUTPUT_MODE" = "--stdout" ]; then
  echo "$SUMMARY"
else
  echo "$SUMMARY" > "$SUMMARY_FILE"
  echo "OK: Summary written to $SUMMARY_FILE ($AGENT_COUNT agents)"
fi
