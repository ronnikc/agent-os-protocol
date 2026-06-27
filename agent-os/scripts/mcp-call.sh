#!/bin/bash
# agent-os/scripts/mcp-call.sh
#
# Generic MCP GitHub tool caller for Claude Code cloud scheduled sessions.
# Uses curl through the Anthropic API proxy tunnel to call ANY MCP GitHub
# tool directly, bypassing the Claude Code tool namespace entirely.
#
# WHY THIS EXISTS:
# Schedule B (pr-quality-review) was failing every night for a week+ with
# "MCP GitHub tools (mcp__github__list_pull_requests,
# mcp__github__get_pull_request_files) are not available in this environment"
# because the scheduled cloud session does NOT register mcp__github__* tools
# in its Claude Code tool namespace. However, the underlying MCP GitHub
# server IS reachable via the proxy tunnel — which is how mcp-push.sh and
# mcp-create-pr.sh have been working for weeks. This script uses the same
# proxy tunnel to call read tools (list PRs, get PR files, search) the
# same way, letting Task B function independently of Claude Code's tool
# namespace availability.
#
# Usage:
#   bash agent-os/scripts/mcp-call.sh <tool_name> '<json_arguments>'
#
# Examples:
#   bash agent-os/scripts/mcp-call.sh list_pull_requests \
#     '{"owner":"ronnikc","repo":"agent-os-protocol","state":"closed","sort":"updated","direction":"desc","perPage":30}'
#
#   bash agent-os/scripts/mcp-call.sh get_pull_request_files \
#     '{"owner":"ronnikc","repo":"agent-os-protocol","pullNumber":1309}'
#
# Output: the raw tool content (typically a JSON string) written to stdout.
#         For MCP list/search tools that return JSON arrays, pipe through
#         jq to parse further.
#
# Exit codes:
#   0 — success
#   1 — MCP-level error (tool returned error payload)
#   2 — transport error (missing env, curl failure, parse failure)

set -uo pipefail

TOOL_NAME="${1:-}"
ARGS_JSON="${2:-}"

if [[ -z "$TOOL_NAME" || -z "$ARGS_JSON" ]]; then
  echo "Usage: mcp-call.sh <tool_name> '<json_arguments>'" >&2
  exit 2
fi

# Validate args are valid JSON up front
if ! printf '%s' "$ARGS_JSON" | jq . >/dev/null 2>&1; then
  echo "ERROR: arguments must be valid JSON" >&2
  echo "Got: $ARGS_JSON" >&2
  exit 2
fi

# --- Auto-detect CCR session ID ---
# Same logic as mcp-push.sh: scan env vars for cse_* then fall back to files.
SESSION_ID=""
for val in "${!CCR@}" "${!CLAUDE@}" "${!ANTHROPIC@}" "${!SESSION@}"; do
  v="${!val:-}"
  if [[ "$v" =~ cse_[a-zA-Z0-9]+ ]]; then
    SESSION_ID="${BASH_REMATCH[0]}"
    break
  fi
done
if [[ -z "$SESSION_ID" ]]; then
  # Scan ALL env vars
  while IFS='=' read -r k v; do
    if [[ "$v" =~ cse_[a-zA-Z0-9]+ ]]; then
      SESSION_ID="${BASH_REMATCH[0]}"
      break
    fi
  done < <(env)
fi
if [[ -z "$SESSION_ID" ]]; then
  # Fall back to session files
  if [[ -d /home/claude/.claude/remote ]]; then
    for f in /home/claude/.claude/remote/*; do
      if [[ "$(basename "$f")" =~ cse_[a-zA-Z0-9]+ ]]; then
        SESSION_ID="${BASH_REMATCH[0]}"
        break
      fi
    done
  fi
fi
if [[ -z "$SESSION_ID" ]]; then
  echo "ERROR: Could not detect CCR session ID (cse_* not found in env or session files)" >&2
  exit 2
fi

# --- Read auth token ---
OAUTH_TOKEN=""
if [[ -f /home/claude/.claude/remote/.session_ingress_token ]]; then
  OAUTH_TOKEN=$(cat /home/claude/.claude/remote/.session_ingress_token 2>/dev/null | tr -d '\n')
fi
if [[ -z "$OAUTH_TOKEN" && -r /proc/self/fd/4 ]]; then
  OAUTH_TOKEN=$(cat /proc/self/fd/4 2>/dev/null | tr -d '\n')
fi
if [[ -z "$OAUTH_TOKEN" ]]; then
  echo "ERROR: Could not read auth token" >&2
  exit 2
fi

# --- Detect proxy from JAVA_TOOL_OPTIONS ---
JAVA_OPTS="${JAVA_TOOL_OPTIONS:-}"
PROXY_HOST=$(echo "$JAVA_OPTS" | grep -oP '(?<=-Dhttps\.proxyHost=)[^\s]+' | head -1)
PROXY_PORT=$(echo "$JAVA_OPTS" | grep -oP '(?<=-Dhttps\.proxyPort=)[^\s]+' | head -1)
PROXY_USER=$(echo "$JAVA_OPTS" | grep -oP '(?<=-Dhttps\.proxyUser=)[^\s]+' | head -1)
PROXY_PASS=$(echo "$JAVA_OPTS" | grep -oP '(?<=-Dhttps\.proxyPassword=)[^\s]+' | head -1)
PROXY_CONFIGURED=0
if [[ -n "$PROXY_HOST" ]]; then
  PROXY_CONFIGURED=1
fi
PROXY_HOST="${PROXY_HOST:-21.0.0.31}"
PROXY_PORT="${PROXY_PORT:-15004}"

# --- Build JSON-RPC request body ---
REQUEST_BODY=$(jq -c -n \
  --arg tool "$TOOL_NAME" \
  --argjson args "$ARGS_JSON" \
  '{jsonrpc:"2.0", id:1, method:"tools/call", params:{name:$tool, arguments:$args}}')

# --- MCP server ID (github is the canonical default) ---
MCP_SERVER_ID="${MCP_SERVER_ID:-f88c92ac-3a8a-54d5-a9d5-a5c466aaefc2}"

# --- Transport: probe proxy, fall back to direct HTTPS ---
# Mirrors mcp-push.sh / mcp-create-pr.sh (updated 2026-04-20). The curl path
# used to hardcode --proxy and a 60s timeout, so when JAVA_TOOL_OPTIONS was
# empty and the default proxy 21.0.0.31:15004 was unreachable (observed
# 2026-04-21 during a scheduled Task B run) every call hung until curl exit 28
# and the whole scheduled job aborted. We now probe the proxy with a 500ms
# /dev/tcp connect and drop to direct HTTPS when it fails. MCP_TIMEOUT_MS
# overrides the request timeout (default 180s; milliseconds for parity with
# the Node scripts).
TIMEOUT_MS="${MCP_TIMEOUT_MS:-180000}"
# curl's --max-time takes seconds; round ms up, minimum 1.
TIMEOUT_SECS=$(( (TIMEOUT_MS + 999) / 1000 ))
if (( TIMEOUT_SECS < 1 )); then TIMEOUT_SECS=1; fi

USE_PROXY=0
if timeout 0.5 bash -c ":</dev/tcp/${PROXY_HOST}/${PROXY_PORT}" 2>/dev/null; then
  USE_PROXY=1
fi

# --- Make the HTTPS call via curl ---
# curl handles: CONNECT tunneling, TLS, chunked transfer-encoding, SSE.
if (( USE_PROXY == 1 )); then
  echo "Transport: proxy ${PROXY_HOST}:${PROXY_PORT} (timeout ${TIMEOUT_SECS}s)" >&2
  PROXY_URL="http://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}"
  RESPONSE=$(curl -s --max-time "$TIMEOUT_SECS" \
    --proxy "$PROXY_URL" \
    --proxytunnel \
    -H "Authorization: Bearer $OAUTH_TOKEN" \
    -H "X-MCP-Server-ID: $MCP_SERVER_ID" \
    -H "Content-Type: application/json" \
    -d "$REQUEST_BODY" \
    "https://api.anthropic.com/v2/ccr-sessions/${SESSION_ID}/github/mcp")
  CURL_EXIT=$?
else
  if (( PROXY_CONFIGURED == 1 )); then
    echo "WARN: configured proxy ${PROXY_HOST}:${PROXY_PORT} unreachable; falling back to direct HTTPS" >&2
  fi
  echo "Transport: direct HTTPS to api.anthropic.com (timeout ${TIMEOUT_SECS}s)" >&2
  RESPONSE=$(curl -s --max-time "$TIMEOUT_SECS" \
    -H "Authorization: Bearer $OAUTH_TOKEN" \
    -H "X-MCP-Server-ID: $MCP_SERVER_ID" \
    -H "Content-Type: application/json" \
    -d "$REQUEST_BODY" \
    "https://api.anthropic.com/v2/ccr-sessions/${SESSION_ID}/github/mcp")
  CURL_EXIT=$?
fi

if [[ $CURL_EXIT -ne 0 ]]; then
  echo "ERROR: curl failed with exit code $CURL_EXIT" >&2
  exit 2
fi

if [[ -z "$RESPONSE" ]]; then
  echo "ERROR: Empty response from MCP server" >&2
  exit 2
fi

# --- Extract JSON from SSE framing ---
# Response format (SSE): "event: message\ndata: {JSON}\n\n"
# Grab the first data: line's payload. If the response is plain JSON
# (no SSE framing), use it directly.
JSON_PAYLOAD=$(echo "$RESPONSE" | grep -m 1 '^data: ' | sed 's/^data: //')
if [[ -z "$JSON_PAYLOAD" ]]; then
  JSON_PAYLOAD="$RESPONSE"
fi

# --- Unwrap MCP tool call response ---
# Response shape: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"..."}]}}
# The text field typically contains stringified JSON (for list/get tools).
ERROR_MSG=$(echo "$JSON_PAYLOAD" | jq -r '.error // empty' 2>/dev/null)
if [[ -n "$ERROR_MSG" && "$ERROR_MSG" != "null" ]]; then
  echo "MCP error: $ERROR_MSG" >&2
  exit 1
fi

CONTENT_TEXT=$(echo "$JSON_PAYLOAD" | jq -r '.result.content[0].text // empty' 2>/dev/null)
if [[ -n "$CONTENT_TEXT" ]]; then
  printf '%s\n' "$CONTENT_TEXT"
  exit 0
fi

# Fallback: dump the raw result object if no content wrapper
RESULT=$(echo "$JSON_PAYLOAD" | jq -c '.result // empty' 2>/dev/null)
if [[ -n "$RESULT" && "$RESULT" != "null" ]]; then
  printf '%s\n' "$RESULT"
  exit 0
fi

echo "ERROR: Could not parse MCP response" >&2
echo "Raw: ${JSON_PAYLOAD:0:300}" >&2
exit 2
