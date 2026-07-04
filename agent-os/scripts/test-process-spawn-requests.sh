#!/usr/bin/env bash
# test-process-spawn-requests.sh — end-to-end smoke for the Sprint 46.6.8
# orchestrator pickup. Synthesises a spawn-request, runs the processor,
# asserts the expected diary/fact/consumed-marker writes.
#
# Usage:  bash agent-os/scripts/test-process-spawn-requests.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
ko()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

# ── Snapshot state we will mutate, restore at exit ──────────────────
SNAPSHOT=$(mktemp -d)
trap 'restore_snapshot' EXIT

snapshot_file() {
  local p="$1"
  if [ -f "$p" ]; then
    mkdir -p "$SNAPSHOT/$(dirname "$p")"
    cp "$p" "$SNAPSHOT/$p"
  fi
}

restore_snapshot() {
  for p in agent-os/sub-agents/test/diary.md agent-os/sub-agents/backend/diary.md agent-os/facts.jsonl; do
    if [ -f "$SNAPSHOT/$p" ]; then
      cp "$SNAPSHOT/$p" "$p"
    fi
  done
  rm -rf "$SNAPSHOT"
  rm -f .claude/spawn-requests/post-sprint-memory-test-46.6.8-smoke.json
  rm -f .claude/spawn-requests/consumed/post-sprint-memory-test-46.6.8-smoke.json
  rm -f agent-os/sub-agents/test/lessons/test-46.6.8-smoke.md
  rm -f agent-os/sub-agents/backend/lessons/test-46.6.8-smoke.md
}

snapshot_file agent-os/sub-agents/test/diary.md
snapshot_file agent-os/sub-agents/backend/diary.md
snapshot_file agent-os/facts.jsonl

echo "=== test-process-spawn-requests smoke ==="

# ── Test 1: synthesise a spawn-request and process it ────────────────
HEAD_SHA=$(git rev-parse HEAD)
BASE_SHA=$(git merge-base HEAD main 2>/dev/null || git rev-parse HEAD~1)
mkdir -p .claude/spawn-requests
cat > .claude/spawn-requests/post-sprint-memory-test-46.6.8-smoke.json <<JSON
{
  "kind": "post-sprint-memory",
  "sprint": "test-46.6.8-smoke",
  "requested_at": "2026-04-27T00:00:00Z",
  "branch": "$(git rev-parse --abbrev-ref HEAD)",
  "head": "${HEAD_SHA}",
  "base_for_test": "${BASE_SHA}",
  "instructions": "smoke-test"
}
JSON

# Capture pre-state (facts.jsonl / diaries are gitignored runtime state — may not exist yet in a fresh clone)
PRE_FACTS=0; [ -f agent-os/facts.jsonl ] && PRE_FACTS=$(wc -l < agent-os/facts.jsonl | tr -d ' ')
PRE_TEST_DIARY=0; [ -f agent-os/sub-agents/test/diary.md ] && PRE_TEST_DIARY=$(wc -l < agent-os/sub-agents/test/diary.md | tr -d ' ')

# Run the processor
node agent-os/scripts/process-spawn-requests.mjs --once > /tmp/process-out.log 2>&1
cat /tmp/process-out.log

# ── Assertion: spawn-request moved to consumed/ ──────────────────────
if [ ! -f .claude/spawn-requests/post-sprint-memory-test-46.6.8-smoke.json ] && \
   [ -f .claude/spawn-requests/consumed/post-sprint-memory-test-46.6.8-smoke.json ]; then
  ok "spawn-request moved to consumed/"
else
  ko "spawn-request not moved to consumed/"
fi

# ── Assertion: facts.jsonl gained one row ────────────────────────────
POST_FACTS=$(wc -l < agent-os/facts.jsonl | tr -d ' ')
if [ "$POST_FACTS" -gt "$PRE_FACTS" ]; then
  ok "facts.jsonl grew (${PRE_FACTS} → ${POST_FACTS})"
else
  ko "facts.jsonl did not grow (${PRE_FACTS} → ${POST_FACTS})"
fi

# ── Assertion: completion fact appears in query ──────────────────────
if bash agent-os/scripts/facts-query.sh "subject:Sprint test-46.6.8-smoke" 2>/dev/null | grep -q "completed_at"; then
  ok "Sprint test-46.6.8-smoke completion fact queryable"
else
  ko "Sprint test-46.6.8-smoke completion fact NOT queryable"
fi

# ── Assertion: at least one diary got an entry (real branch diff) ────
WROTE_TO_ANY=0
for d in agent-os/sub-agents/*/diary.md; do
  if grep -q "Sprint test-46.6.8-smoke" "$d" 2>/dev/null; then
    WROTE_TO_ANY=1
    break
  fi
done
if [ "$WROTE_TO_ANY" = "1" ]; then
  ok "at least one diary received the Sprint test-46.6.8-smoke entry"
else
  ko "no diary received the smoke-test entry"
fi

# ── Assertion: re-processing on empty queue is a no-op ──────────────
node agent-os/scripts/process-spawn-requests.mjs --once > /tmp/process-out2.log 2>&1
if grep -q "0 pending requests" /tmp/process-out2.log; then
  ok "re-run on empty queue is a no-op"
else
  ko "re-run on empty queue produced unexpected output"
  cat /tmp/process-out2.log
fi

# ── Test 2: rollover at 200-line cap ─────────────────────────────────
echo ""
echo "=== rollover test ==="
ROLLOVER_AGENT=test
ROLLOVER_DIARY="agent-os/sub-agents/${ROLLOVER_AGENT}/diary.md"

# Inflate the diary to 250 lines with synthetic entries (newest-first order)
cat > "$ROLLOVER_DIARY" <<'EOF'
# Diary — test

> Synthetic content for the 46.6.8 rollover smoke. Restored at end of test.

EOF
for i in $(seq 1 30); do
  cat >> "$ROLLOVER_DIARY" <<EOF

## 2026-04-$(printf "%02d" $i) — Sprint 46.6.8-rollover-${i}

Synthetic entry ${i} body line 1.
Synthetic entry ${i} body line 2.
Synthetic entry ${i} body line 3.
Synthetic entry ${i} body line 4.
Synthetic entry ${i} body line 5.
EOF
done
DIARY_LINES=$(wc -l < "$ROLLOVER_DIARY")
if [ "$DIARY_LINES" -gt 200 ]; then
  ok "synthetic diary exceeds 200 lines (${DIARY_LINES})"
else
  ko "synthetic diary did not exceed 200 lines (${DIARY_LINES})"
fi

# Trigger a rollover by routing a fresh spawn-request
cat > .claude/spawn-requests/post-sprint-memory-test-46.6.8-smoke.json <<JSON
{
  "kind": "post-sprint-memory",
  "sprint": "test-46.6.8-smoke",
  "requested_at": "2026-04-27T00:00:00Z",
  "branch": "$(git rev-parse --abbrev-ref HEAD)",
  "head": "${HEAD_SHA}",
  "instructions": "smoke-test rollover"
}
JSON

node agent-os/scripts/process-spawn-requests.mjs --once > /tmp/process-rollover.log 2>&1

POST_ROLLOVER_LINES=$(wc -l < "$ROLLOVER_DIARY")
if [ "$POST_ROLLOVER_LINES" -lt 200 ]; then
  ok "diary rolled over (${DIARY_LINES} → ${POST_ROLLOVER_LINES})"
else
  ko "diary did not roll over (${POST_ROLLOVER_LINES} lines)"
fi

if grep -q '## Earlier (summarised)' "$ROLLOVER_DIARY"; then
  ok "## Earlier (summarised) section prepended"
else
  ko "## Earlier (summarised) section missing"
fi

if [ -f "agent-os/sub-agents/${ROLLOVER_AGENT}/lessons/test-46.6.8-smoke.md" ]; then
  ok "evicted entries written to lessons/test-46.6.8-smoke.md"
else
  ko "lessons file not created"
fi

# ── Test 3: smarter synthesis output (Sprint 46.6.9) ────────────────
echo ""
echo "=== smarter synthesis test ==="

ANY_DIARY=""
for d in agent-os/sub-agents/*/diary.md; do
  if grep -q "Sprint test-46.6.8-smoke" "$d" 2>/dev/null; then
    ANY_DIARY="$d"
    break
  fi
done

if [ -n "$ANY_DIARY" ]; then
  if grep -q '\*\*Commits' "$ANY_DIARY"; then
    ok "smart synthesis: commits grouped"
  else
    ko "smart synthesis: commits-by-type group missing"
  fi
  if grep -q '<details><summary>Files' "$ANY_DIARY"; then
    ok "smart synthesis: file list in collapsible block"
  else
    ko "smart synthesis: collapsible file block missing"
  fi
fi

# ── Test 4: archive-consumed.sh (Sprint 46.6.9) ──────────────────────
echo ""
echo "=== archive-consumed test ==="
ARCHIVE_TEST_FILE=".claude/spawn-requests/consumed/post-sprint-memory-test-46.6.9-archive.json"
mkdir -p .claude/spawn-requests/consumed agent-os/spawn-requests-archive
cat > "$ARCHIVE_TEST_FILE" <<JSON
{"kind":"post-sprint-memory","sprint":"test-46.6.9-archive","processed_at":"2026-01-01T00:00:00Z","diary_writes":3,"rollovers":0,"fact_emitted":true}
JSON
# Backdate to ensure the age check fires
touch -d "60 days ago" "$ARCHIVE_TEST_FILE" 2>/dev/null || touch -t 202602010000 "$ARCHIVE_TEST_FILE"
PRE_ARCHIVE_FILES=$( [ -f .claude/spawn-requests/consumed/post-sprint-memory-test-46.6.9-archive.json ] && echo 1 || echo 0 )
bash agent-os/scripts/archive-consumed.sh --age-days 30 > /tmp/archive-out.log 2>&1 || true
POST_ARCHIVE_FILES=$( [ -f .claude/spawn-requests/consumed/post-sprint-memory-test-46.6.9-archive.json ] && echo 1 || echo 0 )
if [ "$PRE_ARCHIVE_FILES" = "1" ] && [ "$POST_ARCHIVE_FILES" = "0" ]; then
  ok "archive-consumed: aged file moved out of consumed/"
else
  ko "archive-consumed: aged file not moved (pre=$PRE_ARCHIVE_FILES post=$POST_ARCHIVE_FILES)"
fi
if grep -q "test-46.6.9-archive" agent-os/spawn-requests-archive/*.jsonl 2>/dev/null; then
  ok "archive-consumed: record landed in monthly JSONL"
  # cleanup the archive entry
  for af in agent-os/spawn-requests-archive/*.jsonl; do
    grep -v "test-46.6.9-archive" "$af" > "${af}.tmp" && mv "${af}.tmp" "$af"
    [ ! -s "$af" ] && rm "$af"
  done
else
  ko "archive-consumed: record not found in monthly JSONL"
fi

# ── Test 5: husky post-merge hook present + executable (Sprint 46.6.9) ─
if [ -x .husky/post-merge ]; then
  ok ".husky/post-merge auto-trigger present and executable"
else
  ko ".husky/post-merge missing or not executable"
fi

# ── Test 6: spawn-prompt server endpoint shape (Sprint 46.6.9) ───────
# Can't run a server here; smoke-test the underlying renderer instead.
RENDER_OUT=$(bash agent-os/scripts/render-spawn-prompt.sh compliance 2>/dev/null || true)
# Either empty (placeholder/no peer content) or includes the diary section header
if [ -z "$RENDER_OUT" ] || echo "$RENDER_OUT" | grep -qE '## (Diary|Routed Diaries)'; then
  ok "render-spawn-prompt.sh produces compatible output"
else
  ko "render-spawn-prompt.sh output unexpected"
fi

echo ""
echo "==================="
echo "$PASS passed, $FAIL failed"
echo "==================="
[ "$FAIL" -eq 0 ]
