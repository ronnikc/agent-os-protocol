#!/bin/bash
# agent-os/scripts/shared-mem-read.sh
# Read shared memory state for one or all agents.
#
# Usage: bash agent-os/scripts/shared-mem-read.sh [agent-name]
# No args = read all agents. With agent name = read that agent only.
#
# Sprint 38.5.0 — Phase 3: Shared Memory Bus

set -euo pipefail

AGENT="${1:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="$REPO_ROOT/agent-os/shared-memory/state"

if [ ! -d "$STATE_DIR" ]; then
  echo "(no shared memory state directory)"
  exit 0
fi

if [ -n "$AGENT" ]; then
  # ── Read specific agent ──
  STATE_FILE="$STATE_DIR/${AGENT}.json"
  if [ -f "$STATE_FILE" ]; then
    echo "=== ${AGENT} ==="
    cat "$STATE_FILE"
    echo ""
  else
    echo "(no state for agent: $AGENT)"
  fi
else
  # ── Read all agents ──
  FOUND=0
  for STATE_FILE in "$STATE_DIR"/*.json; do
    [ -f "$STATE_FILE" ] || continue
    AGENT_NAME=$(basename "$STATE_FILE" .json)
    [ "$AGENT_NAME" = "panel-processes" ] && continue  # Skip panel internal state
    echo "=== ${AGENT_NAME} ==="
    cat "$STATE_FILE"
    echo ""
    FOUND=$((FOUND + 1))
  done

  if [ "$FOUND" -eq 0 ]; then
    echo "(no agent states found)"
  else
    echo "--- $FOUND agents with shared state ---"
  fi
fi
