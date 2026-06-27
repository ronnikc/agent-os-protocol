#!/usr/bin/env bash
# post-sprint-memory.sh — sprint close-out memory capture hook.
#
# Sprint 46.6.2 — Agent OS Memory v2: Background Capture + Per-Agent Diaries.
# Final hook in the SPRINTS.md → Step E close-out checklist (after tests pass,
# after PR is open).
#
# By spec, this hook spawns a background `documentation` sub-agent that decides
# whether anything happened worth remembering for any of the agents that
# contributed to the sprint, and:
#   1. Appends a one-paragraph entry to agent-os/sub-agents/<agent>/diary.md
#      (≤ 5 lines), and a fuller note to agent-os/sub-agents/<agent>/lessons/<sprint>.md.
#   2. Emits any factual change as a triple via agent-os/scripts/facts-append.sh.
#   3. Rolls older entries out of diary.md when it exceeds 200 lines.
#
# This implementation is a logged shell — the real Claude-spawn integration
# lands in the orchestrator (Agent OS Panel / boss-agent), which sees this
# hook fire and does the LLM call. The hook ALWAYS logs to:
#   agent-os/logs/post-sprint-memory/<sprint>.log
# even on the "no notable lessons" path. Silent zero is forbidden (cross-cutting
# error-parsing concern from the spec).
#
# Usage: bash agent-os/scripts/hooks/post-sprint-memory.sh <sprint-id> [--dry-run]
# Exit:  0 always (never blocks close-out)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

SPRINT="${1:-unknown}"
DRY_RUN=0
if [ "${2:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

# Sprint 46.6.7 Part B — diary rollover summarisation feature flag.
# Default ON. MEMORY_DIARY_SUMMARISE=off restores pure 46.6.2 mechanical
# rollover (no LLM call when a diary trips the 200-line cap).
SUMMARISE="${MEMORY_DIARY_SUMMARISE:-on}"

LOG_DIR="agent-os/logs/post-sprint-memory"
LOG="$LOG_DIR/${SPRINT}.log"
mkdir -p "$LOG_DIR"

ts() { date -Iseconds; }

{
  echo "[$(ts)] post-sprint-memory: started for sprint=$SPRINT dry_run=$DRY_RUN"

  # Surface what changed (lets the spawned agent decide if it's worth remembering).
  CHANGED_FILES=$(git diff --name-only main...HEAD 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  COMMITS=$(git log main..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ' || echo "0")

  echo "[$(ts)] sprint=$SPRINT  commits=$COMMITS  files_changed=$CHANGED_FILES"

  # Spawn flag — picked up by the orchestrator (Agent OS Panel / boss-agent loop).
  # Until that integration lands, the hook is a structured log and a no-op for
  # diary writes. The structured log is intentionally machine-readable so the
  # orchestrator can replay missed sprints later.
  SPAWN_REQ=".claude/spawn-requests/post-sprint-memory-${SPRINT}.json"
  mkdir -p .claude/spawn-requests
  # Sprint 46.6.7 Part B: rollover instruction differs based on the
  # MEMORY_DIARY_SUMMARISE flag.
  if [ "$SUMMARISE" = "off" ]; then
    ROLLOVER_INSTR="if any diary > 200 lines after writes, move oldest entries into the most recent lessons file (mechanical rollover only — MEMORY_DIARY_SUMMARISE=off)"
  else
    ROLLOVER_INSTR="if any diary > 200 lines after writes: (a) move oldest entries verbatim into the most recent lessons file, (b) summarise the evicted entries into ≤5 bullet points using the cheapest capable model (Haiku family per current routing), (c) prepend the result as a '## Earlier (summarised)' section at the head of diary.md REPLACING any existing such section (never stacking). Cost guards: 1 summarisation call per agent per rollover, ≤4KB of evicted entries fed to the summariser (truncate older entries with a note '(older entries omitted from summary; see lesson file)' if the eviction exceeds 4KB), 10s timeout — on timeout/failure fall back to mechanical rollover and log the reason"
  fi

  cat > "$SPAWN_REQ" <<JSON
{
  "kind": "post-sprint-memory",
  "sprint": "${SPRINT}",
  "requested_at": "$(ts)",
  "branch": "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)",
  "head": "$(git rev-parse HEAD 2>/dev/null || echo unknown)",
  "commits_against_main": ${COMMITS},
  "files_changed_against_main": ${CHANGED_FILES},
  "summarise_rollover": "${SUMMARISE}",
  "instructions": "Spawn a documentation sub-agent. For each agent that contributed: (1) decide whether anything would help future invocations of that agent — if yes, append ≤5 lines to agent-os/sub-agents/<agent>/diary.md plus a fuller note to lessons/${SPRINT}.md; (2) emit factual changes via agent-os/scripts/facts-append.sh; (3) ${ROLLOVER_INSTR}. Output ≤200-token summary back."
}
JSON

  if [ "$DRY_RUN" = "1" ]; then
    echo "[$(ts)] dry-run mode: spawn request written to $SPAWN_REQ — no agent invoked"
    echo "[$(ts)] decision: dry-run / no notable lessons applied this run"
  else
    echo "[$(ts)] spawn request written: $SPAWN_REQ"
    echo "[$(ts)] orchestrator pickup: pending (Agent OS Panel integration is the runtime owner)"
    echo "[$(ts)] decision: queued for orchestrator (no diary writes performed by the hook itself)"
  fi
} >> "$LOG" 2>&1

# Silence the hook's stdout so close-out output stays clean — full record is
# in the log file. The cross-cutting "silent zero forbidden" rule is satisfied
# by always writing to the log, regardless of branch.
echo "post-sprint-memory: logged to $LOG"
exit 0
