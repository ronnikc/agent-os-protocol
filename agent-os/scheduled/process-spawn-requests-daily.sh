#!/usr/bin/env bash
# process-spawn-requests-daily.sh — daily fallback for the Memory v2 orchestrator.
#
# Sprint 46.6.9 — auto-trigger (Part A item 1, item 4).
# The husky post-merge hook is the primary trigger; this script is the safety
# net for environments where the hook doesn't fire (CI, server, fresh clones
# that haven't installed husky yet).
#
# Side effects every run:
#   - Process any pending spawn-requests
#   - On Mondays, archive consumed/ files older than 30 days into the
#     monthly JSONL archive
#
# Wired into agent-os/scheduled/config.json by SPRINTS.md Step E.9 follow-up.
# Run manually:  bash agent-os/scheduled/process-spawn-requests-daily.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

# Always run the processor — it's a no-op when the queue is empty.
bash agent-os/scripts/process-spawn-requests.sh

# Weekly archive (Mondays). The retention window is 30 days; older files
# collapse into agent-os/spawn-requests-archive/<year-month>.jsonl.
DAY_OF_WEEK=$(date +%u)
if [ "$DAY_OF_WEEK" = "1" ]; then
  bash agent-os/scripts/archive-consumed.sh --age-days 30
fi
