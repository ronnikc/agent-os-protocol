#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 R Digital
#
# Fresh-clone boot smoke for Agent OS Protocol.
#
# Proves the headline launch claim end-to-end on a clean checkout: install → run all
# verification suites → boot each server (panel / lobby / relay) and probe it over HTTP →
# tear everything down. Exits non-zero on the first failure so it can gate a release.
#
#   bash scripts/smoke.sh
#
# It boots real servers on scratch ports, backgrounds each by PID, and kills them on exit
# (no `pkill`, no foreground `sleep` — readiness is polled with curl).

set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PANEL_PORT="${SMOKE_PANEL_PORT:-4900}"
LOBBY_PORT="${SMOKE_LOBBY_PORT:-4901}"
RELAY_PORT="${SMOKE_RELAY_PORT:-4902}"
TMP="$(mktemp -d)"
PIDS=()
FAILS=0

log()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAILS=$((FAILS+1)); }

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null && wait "$pid" 2>/dev/null
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

# Wait until an HTTP GET to $1 returns a real status (server is listening). $2 = max attempts.
# curl's -w already emits "000" when the connection is refused; --retry-connrefused gives the
# server a moment between attempts, so each loop genuinely waits rather than busy-spinning.
wait_http() {
  local url="$1" tries="${2:-50}" i code
  for ((i=0; i<tries; i++)); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 --retry 1 --retry-connrefused "$url" 2>/dev/null)"
    [ -n "$code" ] && [ "$code" != "000" ] && { echo "$code"; return 0; }
  done
  echo 000; return 1
}

# Boot a server: $1=label $2=logfile $3=readyURL  + remaining args = command.
boot() {
  local label="$1" logf="$2" url="$3"; shift 3
  "$@" >"$logf" 2>&1 &
  local pid=$!
  PIDS+=("$pid")
  local code; code="$(wait_http "$url" 60)"
  if [ "$code" = "000" ]; then
    bad "$label did not come up (see $logf)"; tail -5 "$logf" | sed 's/^/      /'
    return 1
  fi
  ok "$label is up (HTTP $code at $url)"
  return 0
}

log "Environment"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -ge 20 ]; then ok "Node $(node -v) (>= 20)"; else bad "Node >= 20 required (found $(node -v 2>/dev/null))"; fi
if [ -d node_modules ]; then ok "node_modules present"; else
  printf '  installing dependencies…\n'; npm install >"$TMP/install.log" 2>&1 && ok "npm install" || bad "npm install failed"
fi

log "Verification suites (verify-all)"
if npm run --silent verify-all >"$TMP/verify.log" 2>&1; then
  ok "verify-all passed"
  grep -hoE '[0-9]+ passed, [0-9]+ failed' "$TMP/verify.log" | sed 's/^/      /'
else
  bad "verify-all failed"; tail -20 "$TMP/verify.log" | sed 's/^/      /'
fi

log "Boot: Panel (Local Mode, --no-relay)"
boot "Panel" "$TMP/panel.log" "http://localhost:$PANEL_PORT/" \
  npx tsx agent-os/scripts/agent-os-panel-server.ts --no-relay --port "$PANEL_PORT" && {
  rc="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PANEL_PORT/api/runtimes")"
  [ "$rc" = "200" ] && ok "panel /api/runtimes → 200" || bad "panel /api/runtimes → $rc"
  rc="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PANEL_PORT/api/agents")"
  [ "$rc" = "200" ] && ok "panel /api/agents → 200" || bad "panel /api/agents → $rc"
}

log "Boot: Lobby (standalone Node WS server)"
boot "Lobby" "$TMP/lobby.log" "http://localhost:$LOBBY_PORT/api/v1/agent-lobby/discover" \
  npx tsx packages/lobby-server/src/server.ts --port "$LOBBY_PORT" && {
  curl -s "http://localhost:$LOBBY_PORT/api/v1/agent-lobby/discover" | grep -q 'lobby_id' \
    && ok "lobby discover returns a lobby" || bad "lobby discover payload unexpected"
}

log "Boot: Relay (browser ↔ runtime bridge)"
boot "Relay" "$TMP/relay.log" "http://localhost:$RELAY_PORT/health" \
  npx tsx packages/relay/src/relay-server.ts --port "$RELAY_PORT"

log "Result"
if [ "$FAILS" -eq 0 ]; then
  printf '\033[32mSMOKE PASSED\033[0m — fresh clone boots Local Mode, the lobby, and the relay; all suites green.\n'
  exit 0
else
  printf '\033[31mSMOKE FAILED\033[0m — %s check(s) failed.\n' "$FAILS"
  exit 1
fi
