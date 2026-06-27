#!/bin/bash
# agent-os/scripts/shared-mem-write.sh
# Write to an agent's shared memory state file.
#
# Usage: bash agent-os/scripts/shared-mem-write.sh <agent-name> <key> <value>
# Example: bash agent-os/scripts/shared-mem-write.sh backend-specialist status completed
# Example: bash agent-os/scripts/shared-mem-write.sh backend-specialist finding "API uses /api/v1/tasks with pagination"
#
# Sprint 38.5.0 — Phase 3: Shared Memory Bus

set -euo pipefail

AGENT="${1:?Usage: shared-mem-write.sh <agent-name> <key> <value>}"
KEY="${2:?Usage: shared-mem-write.sh <agent-name> <key> <value>}"
VALUE="${3:?Usage: shared-mem-write.sh <agent-name> <key> <value>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="$REPO_ROOT/agent-os/shared-memory/state"
STATE_FILE="$STATE_DIR/${AGENT}.json"

mkdir -p "$STATE_DIR" 2>/dev/null || true

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown")

# ── Read existing state or initialize ──
if [ -f "$STATE_FILE" ]; then
  EXISTING=$(cat "$STATE_FILE" 2>/dev/null || echo "{}")
else
  EXISTING="{}"
fi

# ── Build updated state using simple approach (no jq dependency) ──
# For simple key-value, we use a line-based JSON format
# Each state file is a flat JSON object

# Check if jq is available for proper JSON handling
if command -v jq &> /dev/null; then
  # Proper JSON update with jq
  echo "$EXISTING" | jq --arg key "$KEY" --arg val "$VALUE" --arg ts "$TIMESTAMP" \
    '. + {($key): $val, "agent": "'"$AGENT"'", "updated_at": $ts}' > "$STATE_FILE"
else
  # Fallback: simple key-value line format (one JSON object)
  # Remove existing key if present, add new value
  TEMP=$(mktemp)

  # If file has valid JSON content, try to preserve it
  if echo "$EXISTING" | grep -q '{' 2>/dev/null; then
    # Strip closing brace, add new field, close
    echo "$EXISTING" | sed 's/}$//' | sed '/^$/d' > "$TEMP"
    # Add comma if there's existing content beyond opening brace
    CONTENT=$(cat "$TEMP")
    if [ "$CONTENT" != "{" ]; then
      echo "," >> "$TEMP"
    fi
    echo "  \"${KEY}\": \"${VALUE}\"," >> "$TEMP"
    echo "  \"agent\": \"${AGENT}\"," >> "$TEMP"
    echo "  \"updated_at\": \"${TIMESTAMP}\"" >> "$TEMP"
    echo "}" >> "$TEMP"
  else
    cat > "$TEMP" <<JSON
{
  "${KEY}": "${VALUE}",
  "agent": "${AGENT}",
  "updated_at": "${TIMESTAMP}"
}
JSON
  fi

  mv "$TEMP" "$STATE_FILE"
fi

echo "OK: ${AGENT}/${KEY} = ${VALUE:0:60}..."
