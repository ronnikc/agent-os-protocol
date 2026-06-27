#!/usr/bin/env bash
# process-spawn-requests.sh — orchestrator pickup for the Memory v2 write path.
#
# Sprint 46.6.8. Closes the load-bearing 46.6.2 / 46.6.7 deferral by actually
# consuming the .claude/spawn-requests/post-sprint-memory-*.json queue: writes
# per-agent diary entries, emits sprint-completion facts via facts-append.sh,
# and rolls over diaries that exceed the 200-line cap.
#
# Wired from SPRINTS.md Step E.9 Part C — runs immediately after
# post-sprint-memory.sh queues a request, so close-out is a one-shot.
#
# Usage:  bash agent-os/scripts/process-spawn-requests.sh [--once]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "process-spawn-requests: node is required" >&2
  exit 2
fi

node agent-os/scripts/process-spawn-requests.mjs "$@"
