#!/bin/bash
# agent-os/scripts/lobby-coordinator.sh
# Sprint coordination orchestrator for Agent Lobby.
# Decomposes sprint spec into task DAG, assigns to agents, tracks execution.
#
# Inspired by open-multi-agent's Coordinator pattern (runTeam).
# Sprint 38.5.0 — Phase 5: Agent Lobby Finalization
#
# Usage:
#   bash lobby-coordinator.sh plan <sprint-spec-path>     — decompose spec into tasks
#   bash lobby-coordinator.sh dispatch                     — start ready tasks
#   bash lobby-coordinator.sh monitor                      — check progress
#   bash lobby-coordinator.sh synthesize                   — generate close-out summary

set -euo pipefail

ACTION="${1:?Usage: lobby-coordinator.sh <plan|dispatch|monitor|synthesize> [args...]}"
shift

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TASK_MGR="$SCRIPT_DIR/lobby-task-manager.sh"
SHARED_MEM="$SCRIPT_DIR/shared-mem-send.sh"
SUMMARY="$SCRIPT_DIR/shared-mem-summary.sh"
ROUTING_CONFIG="$REPO_ROOT/agent-os/scheduled/config.json"

case "$ACTION" in
  plan)
    SPEC_PATH="${1:?Usage: lobby-coordinator.sh plan <sprint-spec-path>}"

    if [ ! -f "$SPEC_PATH" ]; then
      echo "ERROR: Sprint spec not found: $SPEC_PATH" >&2
      exit 1
    fi

    echo "=== Sprint Coordination: Decomposition ==="
    echo "Spec: $SPEC_PATH"
    echo ""

    # Extract sprint number from filename
    SPRINT=$(basename "$SPEC_PATH" .md | sed 's/sprint-//')
    echo "Sprint: $SPRINT"

    # Reset task queue for new sprint
    bash "$TASK_MGR" reset

    # ── Analyze spec for acceptance criteria ──
    echo ""
    echo "Analyzing acceptance criteria..."

    # Extract AC titles from the spec
    AC_LIST=$(grep -oP '^\*\*AC-\d+:.*\*\*' "$SPEC_PATH" 2>/dev/null || \
      grep -oP '^### AC-\d+' "$SPEC_PATH" 2>/dev/null || \
      grep -oP '^\*\*AC-\d+' "$SPEC_PATH" 2>/dev/null || true)

    if [ -z "$AC_LIST" ]; then
      echo "No AC-N patterns found. Checking for numbered acceptance criteria..."
      AC_LIST=$(grep -oP '^\- \[ \].*' "$SPEC_PATH" 2>/dev/null | head -20 || true)
    fi

    AC_COUNT=$(echo "$AC_LIST" | grep -c '.' 2>/dev/null || echo "0")
    echo "Found $AC_COUNT acceptance criteria"

    # ── Determine agent routing based on file paths in spec ──
    echo ""
    echo "Determining agent assignments..."

    HAS_BACKEND=false
    HAS_FRONTEND=false
    HAS_SHARED=false
    HAS_I18N=false

    if grep -q 'src/backend/' "$SPEC_PATH" 2>/dev/null; then HAS_BACKEND=true; fi
    if grep -q 'src/frontend/' "$SPEC_PATH" 2>/dev/null; then HAS_FRONTEND=true; fi
    if grep -q 'src/shared/' "$SPEC_PATH" 2>/dev/null; then HAS_SHARED=true; fi
    if grep -qiE '(i18n|locale|translation)' "$SPEC_PATH" 2>/dev/null; then HAS_I18N=true; fi

    # ── Create tasks based on analysis ──
    TASK_NUM=0

    # Shared types first (no dependencies)
    if [ "$HAS_SHARED" = true ]; then
      TASK_NUM=$((TASK_NUM + 1))
      bash "$TASK_MGR" add "Implement shared types and constants" "backend-specialist"
      SHARED_TASK="task-$(printf '%03d' $TASK_NUM)"
    fi

    # Backend (depends on shared if present)
    if [ "$HAS_BACKEND" = true ]; then
      TASK_NUM=$((TASK_NUM + 1))
      if [ "$HAS_SHARED" = true ]; then
        bash "$TASK_MGR" add "Implement backend services and routes" "backend-specialist" "$SHARED_TASK"
      else
        bash "$TASK_MGR" add "Implement backend services and routes" "backend-specialist"
      fi
      BACKEND_TASK="task-$(printf '%03d' $TASK_NUM)"
    fi

    # Frontend (depends on backend and shared if present)
    if [ "$HAS_FRONTEND" = true ]; then
      TASK_NUM=$((TASK_NUM + 1))
      DEPS=""
      [ "$HAS_SHARED" = true ] && DEPS="$SHARED_TASK"
      [ "$HAS_BACKEND" = true ] && DEPS="${DEPS:+$DEPS }${BACKEND_TASK:-}"
      if [ -n "$DEPS" ]; then
        bash "$TASK_MGR" add "Implement frontend pages and components" "frontend-specialist" $DEPS
      else
        bash "$TASK_MGR" add "Implement frontend pages and components" "frontend-specialist"
      fi
      FRONTEND_TASK="task-$(printf '%03d' $TASK_NUM)"
    fi

    # I18N (depends on frontend)
    if [ "$HAS_I18N" = true ]; then
      TASK_NUM=$((TASK_NUM + 1))
      I18N_DEP="${FRONTEND_TASK:-${BACKEND_TASK:-}}"
      if [ -n "$I18N_DEP" ]; then
        bash "$TASK_MGR" add "Add i18n translations for all 16 locales" "i18n-specialist" "$I18N_DEP"
      else
        bash "$TASK_MGR" add "Add i18n translations for all 16 locales" "i18n-specialist"
      fi
      I18N_TASK="task-$(printf '%03d' $TASK_NUM)"
    fi

    # Close-out (depends on everything)
    TASK_NUM=$((TASK_NUM + 1))
    ALL_DEPS=""
    [ -n "${FRONTEND_TASK:-}" ] && ALL_DEPS="$FRONTEND_TASK"
    [ -n "${BACKEND_TASK:-}" ] && ALL_DEPS="${ALL_DEPS:+$ALL_DEPS }${BACKEND_TASK}"
    [ -n "${I18N_TASK:-}" ] && ALL_DEPS="${ALL_DEPS:+$ALL_DEPS }${I18N_TASK}"
    if [ -n "$ALL_DEPS" ]; then
      bash "$TASK_MGR" add "Sprint close-out gates E0-E12" "sprint-gate-enforcer" $ALL_DEPS
    else
      bash "$TASK_MGR" add "Sprint close-out gates E0-E12" "sprint-gate-enforcer"
    fi

    echo ""
    echo "=== Task DAG Created ==="
    bash "$TASK_MGR" dag
    echo ""
    bash "$TASK_MGR" status
    ;;

  dispatch)
    echo "=== Dispatching Ready Tasks ==="
    bash "$TASK_MGR" ready
    echo ""
    echo "To start a task, agents should:"
    echo "  1. Run: bash agent-os/scripts/shared-mem-write.sh <agent-name> status in_progress"
    echo "  2. Do the work"
    echo "  3. Run: bash agent-os/scripts/lobby-task-manager.sh complete <task-id> <summary>"
    echo "  4. Run: bash agent-os/scripts/shared-mem-send.sh <agent> '*' completion <summary>"
    ;;

  monitor)
    echo "=== Sprint Progress ==="
    bash "$TASK_MGR" status
    echo ""
    echo "=== Team Memory ==="
    bash "$SUMMARY" --stdout 2>/dev/null || echo "(no shared memory data)"
    ;;

  synthesize)
    echo "=== Sprint Synthesis ==="
    echo ""

    # Check all tasks completed
    TOTAL=$(wc -l < "$REPO_ROOT/agent-os/shared-memory/tasks.jsonl" 2>/dev/null || echo "0")
    COMPLETED=$(grep -c '"status":"completed"' "$REPO_ROOT/agent-os/shared-memory/tasks.jsonl" 2>/dev/null || echo "0")
    FAILED=$(grep -c '"status":"failed"' "$REPO_ROOT/agent-os/shared-memory/tasks.jsonl" 2>/dev/null || echo "0")

    echo "Tasks: ${COMPLETED}/${TOTAL} completed, ${FAILED} failed"
    echo ""

    if [ "$COMPLETED" -eq "$TOTAL" ] && [ "$FAILED" -eq 0 ]; then
      echo "STATUS: All tasks completed successfully"
      echo "NEXT: Run close-out gates E0-E12"
    elif [ "$FAILED" -gt 0 ]; then
      echo "STATUS: Sprint has ${FAILED} failed tasks"
      echo "NEXT: Resolve failures before close-out"
      echo ""
      echo "Failed tasks:"
      grep '"status":"failed"' "$REPO_ROOT/agent-os/shared-memory/tasks.jsonl" 2>/dev/null | while IFS= read -r line; do
        TID=$(echo "$line" | grep -oP '"id"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
        TTITLE=$(echo "$line" | grep -oP '"title"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
        REASON=$(echo "$line" | grep -oP '"result_summary"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
        echo "  ✗ ${TID}: ${TTITLE} — ${REASON}"
      done
    else
      REMAINING=$((TOTAL - COMPLETED))
      echo "STATUS: ${REMAINING} tasks still pending"
      echo "NEXT: Continue execution via 'dispatch' command"
    fi
    ;;

  *)
    echo "ERROR: Unknown action: ${ACTION}" >&2
    echo "Usage: lobby-coordinator.sh <plan|dispatch|monitor|synthesize>" >&2
    exit 1
    ;;
esac
