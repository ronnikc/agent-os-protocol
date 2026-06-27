#!/bin/bash
# agent-os/scripts/lobby-floor-control.sh
# Programmatic floor control enforcement for Agent Lobby.
# Validates messages before delivery based on LOBBY-PROTOCOL.md rules.
#
# Inspired by open-multi-agent's MessageBus + existing LOBBY-PROTOCOL.md.
# Sprint 38.5.0 — Phase 5: Agent Lobby Finalization
#
# Usage:
#   bash lobby-floor-control.sh validate <from-agent> <message-text>
#   bash lobby-floor-control.sh grant <agent-name>        — grant floor to agent
#   bash lobby-floor-control.sh revoke <agent-name>       — revoke floor
#   bash lobby-floor-control.sh status                     — show floor control state
#   bash lobby-floor-control.sh reset                      — reset all floor state
#
# Exit codes:
#   0 — message allowed
#   1 — message rejected (reason on stderr)

set -euo pipefail

ACTION="${1:?Usage: lobby-floor-control.sh <validate|grant|revoke|status|reset> [args...]}"
shift

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FLOOR_STATE="/tmp/agent-os-floor-control.json"
RATE_LIMIT_DIR="/tmp/agent-os-rate-limits"

mkdir -p "$RATE_LIMIT_DIR" 2>/dev/null || true

# ── Initialize floor state if missing ──
if [ ! -f "$FLOOR_STATE" ]; then
  echo '{"boss":"","active_speaker":"","phase":"idle"}' > "$FLOOR_STATE"
fi

case "$ACTION" in
  validate)
    FROM="${1:?Usage: lobby-floor-control.sh validate <from-agent> <message-text>}"
    MESSAGE="${2:-}"

    # ── Rate limiting: max 1 message per agent per 10 seconds ──
    RATE_FILE="$RATE_LIMIT_DIR/${FROM}.ts"
    NOW=$(date +%s 2>/dev/null || echo "0")

    if [ -f "$RATE_FILE" ]; then
      LAST_MSG=$(cat "$RATE_FILE" 2>/dev/null || echo "0")
      ELAPSED=$((NOW - LAST_MSG))
      if [ "$ELAPSED" -lt 10 ] 2>/dev/null; then
        echo "REJECTED: Rate limit — ${FROM} must wait $((10 - ELAPSED))s between messages" >&2
        exit 1
      fi
    fi

    # ── Check floor control ──
    ACTIVE_SPEAKER=$(grep -oP '"active_speaker"\s*:\s*"([^"]*)"' "$FLOOR_STATE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || true)
    BOSS=$(grep -oP '"boss"\s*:\s*"([^"]*)"' "$FLOOR_STATE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || true)
    PHASE=$(grep -oP '"phase"\s*:\s*"([^"]*)"' "$FLOOR_STATE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || true)

    # Boss Agent always has floor
    if [ "$FROM" = "$BOSS" ]; then
      echo "$NOW" > "$RATE_FILE"
      echo "ALLOWED: Boss Agent has permanent floor"
      exit 0
    fi

    # Human messages always allowed (check if "human" is in the name)
    if echo "$FROM" | grep -qi "human" 2>/dev/null; then
      echo "$NOW" > "$RATE_FILE"
      echo "ALLOWED: Human participants exempt from floor control"
      exit 0
    fi

    # Check if agent has floor
    if [ -n "$ACTIVE_SPEAKER" ] && [ "$FROM" != "$ACTIVE_SPEAKER" ]; then
      # Only allow hand-raise format
      if echo "$MESSAGE" | grep -q '^HAND ' 2>/dev/null; then
        # Validate hand-raise format: exactly one line, <=60 chars
        LINE_COUNT=$(echo "$MESSAGE" | wc -l)
        CHAR_COUNT=${#MESSAGE}

        if [ "$LINE_COUNT" -gt 1 ]; then
          echo "REJECTED: Hand-raise must be exactly one line" >&2
          exit 1
        fi
        if [ "$CHAR_COUNT" -gt 60 ]; then
          echo "REJECTED: Hand-raise must be <=60 chars (got ${CHAR_COUNT})" >&2
          exit 1
        fi

        echo "$NOW" > "$RATE_FILE"
        echo "ALLOWED: Valid hand-raise from ${FROM}"
        exit 0
      else
        echo "REJECTED: ${FROM} does not have floor. Use HAND format to raise hand." >&2
        exit 1
      fi
    fi

    # ── Message format limits (from LOBBY-PROTOCOL.md) ──
    LINE_COUNT=$(echo "$MESSAGE" | wc -l)

    case "$PHASE" in
      roll-call)
        if [ "$LINE_COUNT" -gt 1 ]; then
          echo "REJECTED: Roll-call responses must be 1 line (got ${LINE_COUNT})" >&2
          exit 1
        fi
        ;;
      briefing)
        # Agents should be silent during briefing (hand-raise only)
        if ! echo "$MESSAGE" | grep -q '^HAND ' 2>/dev/null; then
          echo "REJECTED: Agents must be silent during briefing (hand-raise only)" >&2
          exit 1
        fi
        ;;
      execution)
        if [ "$LINE_COUNT" -gt 5 ]; then
          echo "REJECTED: Execution responses max 5 lines (got ${LINE_COUNT})" >&2
          exit 1
        fi
        ;;
    esac

    # ── Check for banned behaviors ──
    if echo "$MESSAGE" | grep -qiE '(acknowledged|got it|understood|will do|copy that)' 2>/dev/null; then
      echo "REJECTED: Acknowledgments are banned (LOBBY-PROTOCOL.md)" >&2
      exit 1
    fi

    if echo "$MESSAGE" | grep -qiE '(my capabilities|I can help with|I specialize in)' 2>/dev/null; then
      echo "REJECTED: Unsolicited capability tables are banned" >&2
      exit 1
    fi

    # ── Allowed ──
    echo "$NOW" > "$RATE_FILE"
    echo "ALLOWED: Message from ${FROM} passes floor control"
    exit 0
    ;;

  grant)
    AGENT="${1:?Usage: lobby-floor-control.sh grant <agent-name>}"
    BOSS=$(grep -oP '"boss"\s*:\s*"([^"]*)"' "$FLOOR_STATE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || true)
    PHASE=$(grep -oP '"phase"\s*:\s*"([^"]*)"' "$FLOOR_STATE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || true)
    echo "{\"boss\":\"${BOSS}\",\"active_speaker\":\"${AGENT}\",\"phase\":\"${PHASE}\"}" > "$FLOOR_STATE"
    echo "OK: Floor granted to ${AGENT}"
    ;;

  revoke)
    AGENT="${1:?Usage: lobby-floor-control.sh revoke <agent-name>}"
    BOSS=$(grep -oP '"boss"\s*:\s*"([^"]*)"' "$FLOOR_STATE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || true)
    PHASE=$(grep -oP '"phase"\s*:\s*"([^"]*)"' "$FLOOR_STATE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || true)
    echo "{\"boss\":\"${BOSS}\",\"active_speaker\":\"\",\"phase\":\"${PHASE}\"}" > "$FLOOR_STATE"
    echo "OK: Floor revoked from ${AGENT}"
    ;;

  status)
    echo "=== Floor Control Status ==="
    cat "$FLOOR_STATE" 2>/dev/null || echo "(no state)"
    echo ""
    echo "Rate limit files:"
    ls -la "$RATE_LIMIT_DIR"/*.ts 2>/dev/null || echo "  (none)"
    ;;

  reset)
    echo '{"boss":"","active_speaker":"","phase":"idle"}' > "$FLOOR_STATE"
    rm -f "$RATE_LIMIT_DIR"/*.ts 2>/dev/null || true
    echo "OK: Floor control state reset"
    ;;

  *)
    echo "ERROR: Unknown action: ${ACTION}" >&2
    exit 1
    ;;
esac
