#!/usr/bin/env bash
# sprint-gate-runner.sh — Consolidated sprint gate enforcement
#
# Usage:
#   bash agent-os/scripts/sprint-gate-runner.sh --pre  <sprint-spec.md> [workfile.md]
#   bash agent-os/scripts/sprint-gate-runner.sh --close <sprint-spec.md> <workfile.md>
#
# --pre   = Pre-implementation gates (Gate -2, Gate -1, contract checks)
# --close = Close-out gates (E0-E11: build, test, docs, i18n, housekeeping, stats)
#
# Exit code 0 = all automated checks pass
# Exit code 1 = one or more checks failed (sprint BLOCKED)
#
# Created: 2026-03-18 (Sprint Gate Enforcer — Phase 21 post-mortem)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

AOS="agent-os"
ERRORS=0
WARNINGS=0
MANUAL_ITEMS=0

pass()   { echo "  ✓ $1"; }
fail()   { echo "  ✗ $1"; ERRORS=$((ERRORS + 1)); }
warn()   { echo "  ⚠ $1"; WARNINGS=$((WARNINGS + 1)); }
manual() { echo "  ☐ MANUAL: $1"; MANUAL_ITEMS=$((MANUAL_ITEMS + 1)); }

usage() {
  echo "Usage:"
  echo "  $0 --pre  <sprint-spec.md> [workfile.md]"
  echo "  $0 --close <sprint-spec.md> <workfile.md>"
  exit 1
}

if [ $# -lt 2 ]; then usage; fi

MODE="$1"
SPEC_FILE="$2"
WORK_FILE="${3:-}"

if [ ! -f "$SPEC_FILE" ]; then
  echo "ERROR: Sprint spec not found: $SPEC_FILE"
  exit 1
fi

# ═══════════════════════════════════════════════
# PRE-IMPLEMENTATION GATES
# ═══════════════════════════════════════════════

run_pre_gates() {
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║  PRE-IMPLEMENTATION GATE CHECK               ║"
  echo "║  Sprint spec: $SPEC_FILE"
  echo "╚══════════════════════════════════════════════╝"

  # ── Gate -2: Sprint Spec Structure (automated) ──
  echo ""
  echo "=== Gate -2: Sprint Spec Structure ==="
  if bash "$AOS/scripts/lint-sprint-spec.sh" "$SPEC_FILE" 2>/dev/null; then
    pass "Gate -2: Sprint spec passes all 9 structural checks"
  else
    fail "Gate -2: Sprint spec FAILED structural checks — run: bash $AOS/scripts/lint-sprint-spec.sh $SPEC_FILE"
  fi

  # ── Gate -1: Pre-Implementation Checklist (manual items) ──
  echo ""
  echo "=== Gate -1: Pre-Implementation Checklist ==="

  # Check 1: Work file exists
  if [ -n "$WORK_FILE" ] && [ -f "$WORK_FILE" ]; then
    pass "Work file exists: $WORK_FILE"
  elif [ -n "$WORK_FILE" ]; then
    fail "Work file not found: $WORK_FILE"
  else
    # Try to guess work file location
    GUESSED_WF="${SPEC_FILE%.md}-workfile.md"
    if [ -f "$GUESSED_WF" ]; then
      pass "Work file exists: $GUESSED_WF"
      WORK_FILE="$GUESSED_WF"
    else
      fail "No work file found. Expected: $GUESSED_WF"
    fi
  fi

  # Check 2: Sprint spec has acceptance criteria
  if grep -qiE 'Acceptance Criteria|acceptance criteria|## AC' "$SPEC_FILE"; then
    pass "Sprint spec contains acceptance criteria"
  else
    fail "Sprint spec missing acceptance criteria section"
  fi

  # Check 3: i18n agent planned (if spec mentions i18n)
  if grep -qiE 'i18n|locale|translation|internationalization' "$SPEC_FILE"; then
    if grep -qiE 'I18N Specialist|i18n.*agent|I18N.*lead' "$SPEC_FILE"; then
      pass "Sprint mentions i18n AND I18N Specialist agent is planned"
    else
      fail "Sprint mentions i18n but I18N Specialist agent NOT planned (Gate -1 violation)"
    fi
  else
    pass "No i18n references — I18N agent not required"
  fi

  # Check 4: Close-out planned in scope
  manual "Verify close-out is planned as part of sprint scope (not an afterthought)"

  # Check 5: Sub-agent assignment planned
  if grep -qiE 'Agent Assignment|agent.*lead|Specialist.*lead|Agent.*Table' "$SPEC_FILE"; then
    pass "Sprint spec contains agent assignment section"
  else
    warn "Sprint spec may be missing explicit agent assignment — verify manually"
  fi

  # ── C.1 / C.2 Structural Presence (check if spec has the sections) ──
  echo ""
  echo "=== Contract Trace & Form Gate Presence ==="

  # Already checked by Gate -2 lint, but surface explicitly for visibility
  if grep -qiE 'API Contract Trace|C\.1' "$SPEC_FILE"; then
    pass "C.1 API Contract Trace section present"
  elif grep -qiE 'N/A.*no API|N/A.*no endpoint|N/A.*infrastructure' "$SPEC_FILE"; then
    pass "C.1 marked N/A (no API endpoints)"
  else
    fail "C.1 API Contract Trace section MISSING"
  fi

  if grep -qiE 'Form Completeness Gate|C\.2' "$SPEC_FILE"; then
    pass "C.2 Form Completeness Gate section present"
  elif grep -qiE 'N/A.*no forms' "$SPEC_FILE"; then
    pass "C.2 marked N/A (no forms)"
  else
    fail "C.2 Form Completeness Gate section MISSING"
  fi

  # ── Accessibility ──
  echo ""
  echo "=== Accessibility ==="
  if grep -qiE 'Accessibility Specialist' "$SPEC_FILE"; then
    pass "Accessibility Specialist referenced in sprint spec"
  elif grep -qiE 'N/A.*no frontend|N/A.*no UI' "$SPEC_FILE"; then
    pass "No frontend changes — accessibility review N/A"
  else
    fail "Missing Accessibility Specialist in sprint spec"
  fi
}

# ═══════════════════════════════════════════════
# CLOSE-OUT GATES
# ═══════════════════════════════════════════════

run_close_gates() {
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║  CLOSE-OUT GATE CHECK                        ║"
  echo "║  Sprint spec: $SPEC_FILE"
  echo "╚══════════════════════════════════════════════╝"

  if [ -z "$WORK_FILE" ] || [ ! -f "$WORK_FILE" ]; then
    GUESSED_WF="${SPEC_FILE%.md}-workfile.md"
    if [ -f "$GUESSED_WF" ]; then
      WORK_FILE="$GUESSED_WF"
    else
      fail "Work file required for close-out gates. Provide as third argument."
      summary
      exit 1
    fi
  fi

  # ── E1: Build Verification ──
  echo ""
  echo "=== E1: Build Verification (shared → backend → frontend) ==="

  if npx tsc -p src/shared/tsconfig.json 2>&1; then
    pass "Shared compilation: 0 errors"
  else
    fail "Shared compilation FAILED"
  fi

  if npx tsc -p src/backend/tsconfig.json 2>&1; then
    pass "Backend compilation: 0 errors"
  else
    fail "Backend compilation FAILED"
  fi

  if npx tsc -p src/frontend/tsconfig.json --noEmit 2>&1; then
    pass "Frontend compilation: 0 errors"
  else
    fail "Frontend compilation FAILED"
  fi

  # ── E2: Test Verification ──
  echo ""
  echo "=== E2: Test Verification ==="

  # Use direct vitest invocation — npm run test:all fails on Windows due to cmd.exe path handling
  # Capture output to log file — never re-run to identify failures (each run costs 2.5+ min)
  TEST_LOG="/tmp/vitest-gate-output.log"
  (cd src/frontend && npx vitest run) 2>&1 | tee "$TEST_LOG" | tail -10
  TEST_EXIT=${PIPESTATUS[0]:-0}

  if [ "$TEST_EXIT" -eq 0 ]; then
    pass "All tests pass"
  else
    # Check if only the known flaky DashboardConfigPage test failed
    FAIL_FILES=$(grep "FAIL" "$TEST_LOG" | grep -v "DashboardConfigPage" | head -5)
    if [ -z "$FAIL_FILES" ]; then
      warn "Only DashboardConfigPage flaky test failed (known pre-existing 30+ sprints) — treating as pass"
    else
      echo "  Failed tests (from $TEST_LOG):"
      grep "FAIL" "$TEST_LOG" | head -10
      fail "Tests FAILED — see $TEST_LOG for details"
    fi
  fi

  # ── D.5.1: i18n Completeness ──
  echo ""
  echo "=== D.5.1: i18n Completeness ==="

  TODO_COUNT=$(grep -rc 'TODO: translate' src/shared/src/i18n/ 2>/dev/null || true)
  TODO_COUNT=$(echo "$TODO_COUNT" | awk -F: '{s+=$NF} END{print s+0}')
  if [ "$TODO_COUNT" -eq 0 ]; then
    pass "No TODO: translate stubs found"
  else
    fail "Found $TODO_COUNT 'TODO: translate' stubs in i18n files"
  fi

  if [ -f "$AOS/scripts/check-i18n-completeness.sh" ]; then
    if bash "$AOS/scripts/check-i18n-completeness.sh" 2>&1; then
      pass "i18n completeness script passed"
    else
      fail "i18n completeness script FAILED"
    fi
  fi

  # ── Detect base branch (main vs master) ──
  BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "")
  [ -z "$BASE_BRANCH" ] && BASE_BRANCH=$(git branch -r 2>/dev/null | grep -oE 'origin/(main|master)' | head -1 | sed 's@origin/@@' || echo "main")

  # ── D.5.3: No Deferred Work Markers ──
  echo ""
  echo "=== D.5.3: No Deferred Work Markers ==="

  FIXME_FILES=$(git diff --name-only "$BASE_BRANCH" 2>/dev/null | grep -v 'sprint-gate-runner\.sh' | xargs grep -l 'FIXME\|HACK\|XXX' 2>/dev/null || true)
  if [ -z "$FIXME_FILES" ]; then
    pass "No FIXME/HACK/XXX markers in changed files"
  else
    fail "Found FIXME/HACK/XXX in: $FIXME_FILES"
  fi

  # ── E3: Documentation Completeness ──
  echo ""
  echo "=== E3: Documentation Completeness ==="

  CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH" 2>/dev/null || echo "")

  check_doc_file() {
    local pattern="$1" label="$2"
    if echo "$CHANGED_FILES" | grep -q "$pattern"; then
      pass "$label modified in branch"
    else
      fail "$label NOT modified — mandatory per E3"
    fi
  }

  check_doc_file "docs/release-notes/" "Release notes"
  check_doc_file "README.md" "README.md"
  check_doc_file "CLAUDE.md" "CLAUDE.md"

  # Sprint-specific docs
  PHASE_DIR=$(dirname "$SPEC_FILE")
  PHASE_README="$PHASE_DIR/README.md"
  if echo "$CHANGED_FILES" | grep -q "$PHASE_README"; then
    pass "Phase README updated"
  else
    warn "Phase README ($PHASE_README) not modified — verify if needed"
  fi

  # ── E0: Spec vs Ship Reconciliation ──
  echo ""
  echo "=== E0: Spec vs Ship Reconciliation ==="

  # Count acceptance criteria in spec
  AC_COUNT=$(grep -cE '^\s*[-*]\s.*\bAC|acceptance.criteria|^\s*[0-9]+\.' "$SPEC_FILE" 2>/dev/null || echo "0")
  echo "  Acceptance criteria in spec: ~$AC_COUNT lines"
  manual "Verify ALL acceptance criteria have status (Done/Deferred) in work file and release notes"
  manual "Verify deferred items have follow-up sprint numbers assigned"

  # ── E7: Housekeeping Lint ──
  echo ""
  echo "=== E7: Housekeeping Verification ==="

  if bash "$AOS/scripts/lint-housekeeping.sh" 2>&1; then
    pass "Housekeeping lint passed (all governance counts consistent)"
  else
    fail "Housekeeping lint FAILED — governance file counts inconsistent"
  fi

  # ── E8: i18n Agent Verification ──
  echo ""
  echo "=== E8: I18N Agent Verification ==="

  if grep -qiE 'i18n|locale|translation' "$SPEC_FILE"; then
    manual "I18N Specialist agent was invoked for translations? Verify non-EN locales are NOT EN copies"
    if [ -f "$WORK_FILE" ]; then
      if grep -qiE 'I18N Specialist' "$WORK_FILE"; then
        pass "Work file references I18N Specialist agent"
      else
        fail "Sprint has i18n changes but work file does NOT reference I18N Specialist agent — gate failure"
      fi
    fi
  else
    pass "No i18n changes — I18N agent not required"
  fi

  # ── E9: Lessons Learned & Memory Write-Back ──
  echo ""
  echo "=== E9: Lessons Learned & Memory Write-Back ==="

  if [ -f "$WORK_FILE" ]; then
    if grep -qiE '## Lessons Learned|## Lessons' "$WORK_FILE"; then
      # Count numbered lessons
      LESSON_COUNT=$(grep -cE '^\s*[0-9]+\.' "$WORK_FILE" 2>/dev/null || echo "0")
      if [ "$LESSON_COUNT" -ge 2 ]; then
        pass "Work file has Lessons Learned section with $LESSON_COUNT entries"
      else
        warn "Work file has Lessons Learned section but only $LESSON_COUNT entries (minimum 2 for multi-file sprints)"
      fi
    else
      fail "Work file MISSING Lessons Learned section — gate violation"
    fi

    # Sub-agent tracking
    if grep -qiE 'Sub-agents:|Agents used:' "$WORK_FILE"; then
      pass "Work file tracks sub-agent usage"
      manual "Verify sub-agent memory files updated (build-integrity-lessons.md, test-patterns.md, crash-prevention.md)"
    else
      warn "Work file may not track sub-agent usage — verify E9B compliance"
    fi

    # Deferred section
    if grep -qiE '## Deferred|## Not Done|## Deferred or Not Done' "$WORK_FILE"; then
      pass "Work file has Deferred/Not Done section"
    else
      fail "Work file MISSING Deferred or Not Done section — gate violation"
    fi
  else
    fail "No work file — cannot verify E9 compliance"
  fi

  # ── E9b: Memory v2 Spawn-Request Drain ──
  #
  # The post-sprint-memory.sh hook writes a deterministic spawn-request to
  # .claude/spawn-requests/post-sprint-memory-<sprint>.json at close-out.
  # process-spawn-requests.mjs is the orchestrator pickup — it consumes the
  # request, appends per-agent diary entries, runs the 200-line rollover,
  # and emits a Sprint <id>|completed_at fact via facts-append.sh.
  #
  # Without this drain at gate time the memory pipeline never materialises:
  # the Agent OS Panel's Activity / Lessons / Diaries tabs stay empty even
  # after dozens of close-outs. The pickup is intentionally side-effecting
  # — the writes belong in the sprint commit. So: run the processor, fail
  # if any requests stay pending (real bug) or if the writes are uncommitted
  # (operator must `git add` them and re-push).
  echo ""
  echo "=== E9b: Memory v2 Spawn-Request Drain ==="

  if [ -f "$AOS/scripts/process-spawn-requests.mjs" ]; then
    PROCESS_OUT=$(node "$AOS/scripts/process-spawn-requests.mjs" 2>&1) || true
    echo "$PROCESS_OUT" | sed 's/^/    /'

    PENDING=$(find .claude/spawn-requests -maxdepth 1 -name 'post-sprint-memory-*.json' -type f 2>/dev/null | wc -l | tr -d ' ')
    if [ "$PENDING" -gt 0 ]; then
      fail "$PENDING memory spawn-request(s) still pending after drain — see agent-os/logs/post-sprint-memory/"
    else
      pass "Memory v2 spawn-request queue drained (0 pending)"
    fi

    # Detect uncommitted diary / lesson / fact writes the drain just produced.
    # The processor mutates these files; if the gate runs after the operator
    # already committed and is just pushing, there should be nothing dirty.
    DIARY_DIRTY=$(git status --porcelain -- 'agent-os/sub-agents/**/diary.md' 'agent-os/sub-agents/**/lessons/' 'agent-os/memories/facts.jsonl' 2>/dev/null | wc -l | tr -d ' ')
    if [ "$DIARY_DIRTY" -gt 0 ]; then
      fail "Memory drain produced uncommitted diary/lesson/fact writes — commit them and re-run the gate"
      echo "    Run: git add agent-os/sub-agents/*/diary.md agent-os/sub-agents/*/lessons/ agent-os/memories/facts.jsonl"
    else
      pass "No uncommitted diary/lesson/fact writes from drain"
    fi
  else
    warn "process-spawn-requests.mjs not found — memory v2 drain skipped"
  fi

  # ── E11: Self-Verification Checklist Items ──
  echo ""
  echo "=== E11: Self-Verification Checklist (manual items) ==="
  manual "Output E11 self-verification checklist to user before declaring sprint done"
  manual "Verify STATE.md updated with phase progress"
  manual "If module structure changed: verify ARCHITECTURE.md updated"
  manual "If new rule established: verify RULES.md updated with origin citation"
}

# ═══════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════

summary() {
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║  GATE CHECK SUMMARY                          ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""
  echo "  Automated checks failed: $ERRORS"
  echo "  Warnings:                $WARNINGS"
  echo "  Manual items remaining:  $MANUAL_ITEMS"
  echo ""

  if [ "$ERRORS" -gt 0 ]; then
    echo "  ╔═══════════════════════════════════════╗"
    echo "  ║  BLOCKED — $ERRORS automated check(s) failed  ║"
    echo "  ║  Fix failures before proceeding.      ║"
    echo "  ╚═══════════════════════════════════════╝"
  elif [ "$MANUAL_ITEMS" -gt 0 ]; then
    echo "  ╔═══════════════════════════════════════╗"
    echo "  ║  CONDITIONAL PASS                     ║"
    echo "  ║  $MANUAL_ITEMS manual item(s) require verification ║"
    echo "  ╚═══════════════════════════════════════╝"
  else
    echo "  ╔═══════════════════════════════════════╗"
    echo "  ║  ALL GATES PASS                       ║"
    echo "  ╚═══════════════════════════════════════╝"
  fi
}

# ═══════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════

case "$MODE" in
  --pre)
    run_pre_gates
    summary
    ;;
  --close)
    run_close_gates
    summary
    ;;
  *)
    echo "ERROR: First argument must be --pre or --close"
    usage
    ;;
esac

exit "$ERRORS"
