#!/bin/bash
# agent-os/scripts/shared-mem-inbox.sh
# Read unread messages for a specific agent from the message bus.
#
# Usage: bash agent-os/scripts/shared-mem-inbox.sh <agent-name> [--all]
# Without --all: shows only unread messages (tracked via read-state file)
# With --all: shows all messages addressed to this agent
#
# Sprint 38.5.0 — Phase 3: Shared Memory Bus

set -euo pipefail

AGENT="${1:?Usage: shared-mem-inbox.sh <agent-name> [--all]}"
SHOW_ALL="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUS_FILE="$REPO_ROOT/agent-os/shared-memory/bus.jsonl"
READ_STATE_FILE="$REPO_ROOT/agent-os/shared-memory/state/.read-state-${AGENT}.txt"

if [ ! -f "$BUS_FILE" ] || [ ! -s "$BUS_FILE" ]; then
  echo "(no messages)"
  exit 0
fi

# ── Get messages addressed to this agent or broadcast (*) ──
MESSAGES=$(grep -E "\"to\":\"(${AGENT}|\*|all)\"" "$BUS_FILE" 2>/dev/null | \
  grep -v "\"from\":\"${AGENT}\"" || true)

if [ -z "$MESSAGES" ]; then
  echo "(no messages for $AGENT)"
  exit 0
fi

# ── Filter to unread only (unless --all) ──
if [ "$SHOW_ALL" != "--all" ] && [ -f "$READ_STATE_FILE" ]; then
  LAST_READ_ID=$(cat "$READ_STATE_FILE" 2>/dev/null || true)
  if [ -n "$LAST_READ_ID" ]; then
    # Show only messages after the last read ID
    FOUND_LAST=false
    UNREAD=""
    while IFS= read -r line; do
      MSG_ID=$(echo "$line" | grep -oP '"id"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
      if [ "$FOUND_LAST" = true ]; then
        UNREAD="${UNREAD}${line}"$'\n'
      fi
      if [ "$MSG_ID" = "$LAST_READ_ID" ]; then
        FOUND_LAST=true
      fi
    done <<< "$MESSAGES"
    MESSAGES="$UNREAD"
  fi
fi

if [ -z "$MESSAGES" ]; then
  echo "(no unread messages for $AGENT)"
  exit 0
fi

# ── Display messages ──
echo "=== Inbox for ${AGENT} ==="
echo "$MESSAGES" | while IFS= read -r line; do
  [ -z "$line" ] && continue
  TS=$(echo "$line" | grep -oP '"timestamp"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' | sed 's/T/ /;s/Z//' || true)
  FROM=$(echo "$line" | grep -oP '"from"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
  TYPE=$(echo "$line" | grep -oP '"type"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
  CONTENT=$(echo "$line" | grep -oP '"content"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
  MSG_ID=$(echo "$line" | grep -oP '"id"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)

  echo "  ${TS} [${TYPE}] from ${FROM}: ${CONTENT}"

  # Track last read message
  echo "$MSG_ID" > "$READ_STATE_FILE" 2>/dev/null || true
done

echo "---"
