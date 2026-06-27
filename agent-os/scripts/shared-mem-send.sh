#!/bin/bash
# agent-os/scripts/shared-mem-send.sh
# Send a message on the shared memory message bus.
#
# Usage: bash agent-os/scripts/shared-mem-send.sh <from> <to> <type> <content>
# <to> can be an agent name or "*" for broadcast
# <type>: finding, handoff, blocker, completion, request
#
# Example: bash agent-os/scripts/shared-mem-send.sh backend frontend handoff "API routes ready at /api/v1/tasks"
# Example: bash agent-os/scripts/shared-mem-send.sh backend "*" finding "Pagination uses { data, meta } shape"
#
# Sprint 38.5.0 — Phase 3: Shared Memory Bus

set -euo pipefail

FROM="${1:?Usage: shared-mem-send.sh <from> <to> <type> <content>}"
TO="${2:?Usage: shared-mem-send.sh <from> <to> <type> <content>}"
MSG_TYPE="${3:?Usage: shared-mem-send.sh <from> <to> <type> <content>}"
CONTENT="${4:?Usage: shared-mem-send.sh <from> <to> <type> <content>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUS_FILE="$REPO_ROOT/agent-os/shared-memory/bus.jsonl"

mkdir -p "$REPO_ROOT/agent-os/shared-memory" 2>/dev/null || true

# ── Validate type ──
case "$MSG_TYPE" in
  finding|handoff|blocker|completion|request) ;;
  *) echo "ERROR: type must be finding|handoff|blocker|completion|request" >&2; exit 1 ;;
esac

# ── Build message ──
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown")
MSG_ID="msg-$(date +%Y%m%d%H%M%S)-$$"

# Escape content for JSON
CONTENT_ESC=$(echo "$CONTENT" | sed 's/"/\\"/g' | tr '\n' ' ')

# ── Append to bus ──
echo "{\"id\":\"${MSG_ID}\",\"timestamp\":\"${TIMESTAMP}\",\"from\":\"${FROM}\",\"to\":\"${TO}\",\"type\":\"${MSG_TYPE}\",\"content\":\"${CONTENT_ESC}\"}" >> "$BUS_FILE"

echo "OK: ${FROM} -> ${TO} [${MSG_TYPE}]: ${CONTENT:0:60}..."
