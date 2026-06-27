#!/bin/bash
# agent-os/scripts/lobby-task-manager.sh
# Task DAG management for Agent Lobby sprint coordination.
# Manages tasks with dependency resolution and cascade failure.
#
# Inspired by open-multi-agent's TaskQueue with topological sort.
# Sprint 38.5.0 — Phase 5: Agent Lobby Finalization
#
# Usage:
#   bash lobby-task-manager.sh add <title> <assignee> [depends_on_ids...]
#   bash lobby-task-manager.sh status [task-id]
#   bash lobby-task-manager.sh complete <task-id> <summary>
#   bash lobby-task-manager.sh fail <task-id> <reason>
#   bash lobby-task-manager.sh ready
#   bash lobby-task-manager.sh dag
#   bash lobby-task-manager.sh reset

set -euo pipefail

ACTION="${1:?Usage: lobby-task-manager.sh <add|status|complete|fail|ready|dag|reset> [args...]}"
shift

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TASKS_FILE="$REPO_ROOT/agent-os/shared-memory/tasks.jsonl"

mkdir -p "$REPO_ROOT/agent-os/shared-memory" 2>/dev/null || true
touch "$TASKS_FILE" 2>/dev/null || true

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown")

case "$ACTION" in
  add)
    TITLE="${1:?Usage: lobby-task-manager.sh add <title> <assignee> [depends_on_ids...]}"
    ASSIGNEE="${2:?Usage: lobby-task-manager.sh add <title> <assignee> [depends_on_ids...]}"
    shift 2
    DEPENDS_ON="${*:-}"

    # Generate task ID
    TASK_COUNT=$(wc -l < "$TASKS_FILE" 2>/dev/null || echo "0")
    TASK_ID="task-$(printf '%03d' $((TASK_COUNT + 1)))"

    # Build depends_on as comma-separated string
    DEPS_STR=$(echo "$DEPENDS_ON" | tr ' ' ',')

    # Escape title
    TITLE_ESC=$(echo "$TITLE" | sed 's/"/\\"/g')

    echo "{\"id\":\"${TASK_ID}\",\"title\":\"${TITLE_ESC}\",\"assignee\":\"${ASSIGNEE}\",\"status\":\"pending\",\"depends_on\":\"${DEPS_STR}\",\"created_at\":\"${TIMESTAMP}\",\"completed_at\":\"\",\"result_summary\":\"\"}" >> "$TASKS_FILE"

    # Check if any dependencies are failed -> mark as blocked
    if [ -n "$DEPS_STR" ]; then
      for dep in $(echo "$DEPS_STR" | tr ',' ' '); do
        DEP_STATUS=$(grep "\"id\":\"${dep}\"" "$TASKS_FILE" 2>/dev/null | tail -1 | grep -oP '"status"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
        if [ "$DEP_STATUS" = "failed" ]; then
          # Mark as blocked immediately
          sed -i "s/\"id\":\"${TASK_ID}\",\"title\":\"${TITLE_ESC}\",\"assignee\":\"${ASSIGNEE}\",\"status\":\"pending\"/\"id\":\"${TASK_ID}\",\"title\":\"${TITLE_ESC}\",\"assignee\":\"${ASSIGNEE}\",\"status\":\"blocked\"/" "$TASKS_FILE" 2>/dev/null || true
          echo "CREATED: ${TASK_ID} — ${TITLE} (BLOCKED: dependency ${dep} failed)"
          exit 0
        fi
      done
    fi

    echo "CREATED: ${TASK_ID} — ${TITLE} [assigned: ${ASSIGNEE}]"
    ;;

  status)
    TASK_ID="${1:-}"
    if [ -n "$TASK_ID" ]; then
      # Show specific task
      TASK=$(grep "\"id\":\"${TASK_ID}\"" "$TASKS_FILE" 2>/dev/null | tail -1 || true)
      if [ -z "$TASK" ]; then
        echo "ERROR: Task ${TASK_ID} not found" >&2
        exit 1
      fi
      echo "$TASK"
    else
      # Show all tasks summary
      echo "=== Task Status ==="
      TOTAL=$(wc -l < "$TASKS_FILE" 2>/dev/null || echo "0")
      PENDING=$(grep -c '"status":"pending"' "$TASKS_FILE" 2>/dev/null || echo "0")
      IN_PROGRESS=$(grep -c '"status":"in_progress"' "$TASKS_FILE" 2>/dev/null || echo "0")
      COMPLETED=$(grep -c '"status":"completed"' "$TASKS_FILE" 2>/dev/null || echo "0")
      FAILED=$(grep -c '"status":"failed"' "$TASKS_FILE" 2>/dev/null || echo "0")
      BLOCKED=$(grep -c '"status":"blocked"' "$TASKS_FILE" 2>/dev/null || echo "0")

      echo "Total: ${TOTAL} | Pending: ${PENDING} | In Progress: ${IN_PROGRESS} | Completed: ${COMPLETED} | Failed: ${FAILED} | Blocked: ${BLOCKED}"
      echo ""

      # List each task
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        TID=$(echo "$line" | grep -oP '"id"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
        TTITLE=$(echo "$line" | grep -oP '"title"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
        TSTATUS=$(echo "$line" | grep -oP '"status"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
        TASSIGNEE=$(echo "$line" | grep -oP '"assignee"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
        TDEPS=$(echo "$line" | grep -oP '"depends_on"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)

        ICON="○"
        case "$TSTATUS" in
          completed) ICON="✓" ;;
          in_progress) ICON="◉" ;;
          failed) ICON="✗" ;;
          blocked) ICON="⊘" ;;
        esac

        DEP_STR=""
        [ -n "$TDEPS" ] && DEP_STR=" (deps: ${TDEPS})"
        echo "  ${ICON} ${TID}: ${TTITLE} [${TASSIGNEE}] — ${TSTATUS}${DEP_STR}"
      done < "$TASKS_FILE"
    fi
    ;;

  complete)
    TASK_ID="${1:?Usage: lobby-task-manager.sh complete <task-id> <summary>}"
    SUMMARY="${2:-completed}"
    SUMMARY_ESC=$(echo "$SUMMARY" | sed 's/"/\\"/g')

    # Update task status in-place
    if ! grep -q "\"id\":\"${TASK_ID}\"" "$TASKS_FILE" 2>/dev/null; then
      echo "ERROR: Task ${TASK_ID} not found" >&2
      exit 1
    fi

    # Create temp file with updated status
    TEMP=$(mktemp)
    while IFS= read -r line; do
      if echo "$line" | grep -q "\"id\":\"${TASK_ID}\""; then
        echo "$line" | sed "s/\"status\":\"[^\"]*\"/\"status\":\"completed\"/" | \
          sed "s/\"completed_at\":\"[^\"]*\"/\"completed_at\":\"${TIMESTAMP}\"/" | \
          sed "s/\"result_summary\":\"[^\"]*\"/\"result_summary\":\"${SUMMARY_ESC}\"/"
      else
        echo "$line"
      fi
    done < "$TASKS_FILE" > "$TEMP"
    mv "$TEMP" "$TASKS_FILE"

    echo "COMPLETED: ${TASK_ID}"

    # Check if this unblocks any dependent tasks
    UNBLOCKED=$(grep "\"depends_on\":\".*${TASK_ID}.*\"" "$TASKS_FILE" 2>/dev/null | \
      grep '"status":"pending"' || true)
    if [ -n "$UNBLOCKED" ]; then
      echo "Checking unblocked tasks..."
      echo "$UNBLOCKED" | while IFS= read -r dep_task; do
        DEP_ID=$(echo "$dep_task" | grep -oP '"id"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
        DEPS=$(echo "$dep_task" | grep -oP '"depends_on"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)

        # Check if ALL dependencies are completed
        ALL_DONE=true
        for dep in $(echo "$DEPS" | tr ',' ' '); do
          DEP_STATUS=$(grep "\"id\":\"${dep}\"" "$TASKS_FILE" | tail -1 | grep -oP '"status"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
          if [ "$DEP_STATUS" != "completed" ]; then
            ALL_DONE=false
            break
          fi
        done

        if [ "$ALL_DONE" = true ]; then
          echo "  READY: ${DEP_ID} (all dependencies met)"
        fi
      done
    fi
    ;;

  fail)
    TASK_ID="${1:?Usage: lobby-task-manager.sh fail <task-id> <reason>}"
    REASON="${2:-failed}"
    REASON_ESC=$(echo "$REASON" | sed 's/"/\\"/g')

    if ! grep -q "\"id\":\"${TASK_ID}\"" "$TASKS_FILE" 2>/dev/null; then
      echo "ERROR: Task ${TASK_ID} not found" >&2
      exit 1
    fi

    # Update task status
    TEMP=$(mktemp)
    while IFS= read -r line; do
      if echo "$line" | grep -q "\"id\":\"${TASK_ID}\""; then
        echo "$line" | sed "s/\"status\":\"[^\"]*\"/\"status\":\"failed\"/" | \
          sed "s/\"result_summary\":\"[^\"]*\"/\"result_summary\":\"${REASON_ESC}\"/"
      else
        echo "$line"
      fi
    done < "$TASKS_FILE" > "$TEMP"
    mv "$TEMP" "$TASKS_FILE"

    echo "FAILED: ${TASK_ID} — ${REASON}"

    # Cascade: block dependent tasks
    DEPENDENTS=$(grep "\"depends_on\":\".*${TASK_ID}.*\"" "$TASKS_FILE" 2>/dev/null | \
      grep -v '"status":"completed"' || true)
    if [ -n "$DEPENDENTS" ]; then
      echo "Cascading failure to dependents..."
      echo "$DEPENDENTS" | while IFS= read -r dep_task; do
        DEP_ID=$(echo "$dep_task" | grep -oP '"id"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
        TEMP2=$(mktemp)
        sed "s/\"id\":\"${DEP_ID}\",\(.*\)\"status\":\"[^\"]*\"/\"id\":\"${DEP_ID}\",\1\"status\":\"blocked\"/" "$TASKS_FILE" > "$TEMP2"
        mv "$TEMP2" "$TASKS_FILE"
        echo "  BLOCKED: ${DEP_ID} (dependency ${TASK_ID} failed)"
      done
    fi
    ;;

  ready)
    # List tasks that are ready to execute (pending + all deps completed)
    echo "=== Ready Tasks ==="
    FOUND=0
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      STATUS=$(echo "$line" | grep -oP '"status"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
      [ "$STATUS" != "pending" ] && continue

      DEPS=$(echo "$line" | grep -oP '"depends_on"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)

      ALL_MET=true
      if [ -n "$DEPS" ]; then
        for dep in $(echo "$DEPS" | tr ',' ' '); do
          DEP_STATUS=$(grep "\"id\":\"${dep}\"" "$TASKS_FILE" | tail -1 | grep -oP '"status"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
          if [ "$DEP_STATUS" != "completed" ]; then
            ALL_MET=false
            break
          fi
        done
      fi

      if [ "$ALL_MET" = true ]; then
        TID=$(echo "$line" | grep -oP '"id"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
        TTITLE=$(echo "$line" | grep -oP '"title"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
        TASSIGNEE=$(echo "$line" | grep -oP '"assignee"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
        echo "  ▶ ${TID}: ${TTITLE} [${TASSIGNEE}]"
        FOUND=$((FOUND + 1))
      fi
    done < "$TASKS_FILE"

    if [ "$FOUND" -eq 0 ]; then
      echo "  (no tasks ready — all pending tasks have unmet dependencies)"
    fi
    ;;

  dag)
    # Print task dependency graph
    echo "=== Task DAG ==="
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      TID=$(echo "$line" | grep -oP '"id"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
      TTITLE=$(echo "$line" | grep -oP '"title"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
      TSTATUS=$(echo "$line" | grep -oP '"status"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
      TDEPS=$(echo "$line" | grep -oP '"depends_on"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)

      if [ -n "$TDEPS" ]; then
        for dep in $(echo "$TDEPS" | tr ',' ' '); do
          echo "  ${dep} --> ${TID}"
        done
      else
        echo "  (root) --> ${TID}"
      fi
      echo "  ${TID}: ${TTITLE} [${TSTATUS}]"
    done < "$TASKS_FILE"
    ;;

  reset)
    > "$TASKS_FILE"
    echo "OK: Task queue cleared"
    ;;

  *)
    echo "ERROR: Unknown action: ${ACTION}" >&2
    echo "Usage: lobby-task-manager.sh <add|status|complete|fail|ready|dag|reset>" >&2
    exit 1
    ;;
esac
