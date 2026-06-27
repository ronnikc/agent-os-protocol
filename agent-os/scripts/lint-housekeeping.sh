#!/usr/bin/env bash
# lint-housekeeping.sh — Verify governance file consistency
# See agent-os/HOUSEKEEPING.md for the full checklist this script automates.
# Exit 0 = all checks pass. Non-zero = failures.
#
# Usage: bash agent-os/scripts/lint-housekeeping.sh
# Created: 2026-03-17 (Phase 21 housekeeping gate)
# Updated: 2026-03-17 — Replaced grep -oP (Perl regex) with POSIX-compatible
#          grep -oE + sed. Perl regex is not available on Windows Git Bash.

set -euo pipefail

# Resolve repo root (script lives in agent-os/scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

AOS="agent-os"

ERRORS=0
WARNINGS=0

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; ERRORS=$((ERRORS + 1)); }
warn() { echo "  ⚠ $1"; WARNINGS=$((WARNINGS + 1)); }

# Helper: extract a number that appears immediately before a literal string
# Usage: extract_number_before "file" "suffix pattern"
# e.g. extract_number_before "README.md" "specialized sub-agents" → "24"
extract_number_before() {
  local file="$1" suffix="$2"
  grep -oE "[0-9]+ ${suffix}" "$file" 2>/dev/null | head -1 | grep -oE '^[0-9]+' || echo ""
}

# Helper: extract a number from a markdown table row where the label is in the first column
# Usage: extract_table_value "file" "row label"
# Matches: | row label | 55 | ... → "55"
# Uses awk to get the second pipe-delimited field (the value column)
extract_table_value() {
  local file="$1" label="$2"
  grep "$label" "$file" 2>/dev/null | head -1 | awk -F'|' '{gsub(/[ ,]/, "", $3); print $3}' | grep -oE '^[0-9]+' || echo ""
}

# Helper: extract from "| **Label** | value" markdown table
extract_bold_table_value() {
  local file="$1" label="$2"
  grep "\\*\\*${label}\\*\\*" "$file" 2>/dev/null | head -1 | sed "s/.*\\*\\*${label}\\*\\* *| *//" | grep -oE '^[0-9,]+' | tr -d ',' || echo ""
}

# ── Section 1: Cross-File Count Consistency ──

echo ""
echo "=== Section 1: Cross-File Count Consistency ==="

# 1.1 Agent count
ACTUAL_AGENTS=$(ls $AOS/sub-agents/agents/*.md 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "--- 1.1 Agent count (actual: $ACTUAL_AGENTS) ---"

# Check SUB-AGENTS.md heading — matches "## Agent Roster (24 Agents)"
SA_HEADING=$(grep -oE '[0-9]+ Agents?\)' $AOS/SUB-AGENTS.md 2>/dev/null | head -1 | grep -oE '^[0-9]+' || echo "0")
if [ "$SA_HEADING" = "$ACTUAL_AGENTS" ]; then
  pass "SUB-AGENTS.md heading: $SA_HEADING"
else
  fail "SUB-AGENTS.md heading: found $SA_HEADING, expected $ACTUAL_AGENTS"
fi

# Check SUB-AGENTS.md footer — matches "N agents" near end of file
SA_FOOTER=$(grep -oE '[0-9]+ agents?' $AOS/SUB-AGENTS.md 2>/dev/null | tail -1 | grep -oE '^[0-9]+' || echo "0")
if [ "$SA_FOOTER" = "$ACTUAL_AGENTS" ]; then
  pass "SUB-AGENTS.md footer: $SA_FOOTER"
else
  fail "SUB-AGENTS.md footer: found $SA_FOOTER, expected $ACTUAL_AGENTS"
fi

# Check README.md Agent OS intro — matches "24 specialized sub-agents"
README_AGENTS=$(extract_number_before "README.md" "specialized sub-agents")
if [ -z "$README_AGENTS" ]; then README_AGENTS="0"; fi
if [ "$README_AGENTS" = "$ACTUAL_AGENTS" ]; then
  pass "README.md Agent OS intro: $README_AGENTS"
else
  fail "README.md Agent OS intro: found $README_AGENTS, expected $ACTUAL_AGENTS"
fi

# Check MEMORY.md — matches "24 specialized agents"
MEM_AGENTS=$(extract_number_before "$AOS/MEMORY.md" "specialized agents")
if [ -z "$MEM_AGENTS" ]; then MEM_AGENTS="0"; fi
if [ "$MEM_AGENTS" = "$ACTUAL_AGENTS" ]; then
  pass "MEMORY.md: $MEM_AGENTS"
else
  fail "MEMORY.md: found $MEM_AGENTS, expected $ACTUAL_AGENTS"
fi

# 1.2 Rule count
echo ""
echo "--- 1.2 Rule count ---"
ACTUAL_RULES=$(grep -cE '^\| R-[0-9]+' $AOS/RULES.md 2>/dev/null || echo "0")
echo "  (actual rules in RULES.md: $ACTUAL_RULES)"

README_RULES=$(extract_number_before "README.md" "non-negotiable rules")
if [ -z "$README_RULES" ]; then README_RULES="0"; fi
if [ "$README_RULES" = "$ACTUAL_RULES" ]; then
  pass "README.md Governance Files table: $README_RULES"
else
  fail "README.md Governance Files table: found $README_RULES, expected $ACTUAL_RULES"
fi

AOS_README_RULES=$(extract_number_before "$AOS/README.md" "non-negotiable operational rules")
if [ -z "$AOS_README_RULES" ]; then AOS_README_RULES="0"; fi
if [ "$AOS_README_RULES" = "$ACTUAL_RULES" ]; then
  pass "agent-os/README.md: $AOS_README_RULES"
else
  fail "agent-os/README.md: found $AOS_README_RULES, expected $ACTUAL_RULES"
fi

# 1.3 Skill count (v1.1.0 layered structure: <slug>/SKILL.md)
echo ""
echo "--- 1.3 Skill count ---"
ACTUAL_SKILLS=$(ls -d $AOS/sub-agents/skills/*/ 2>/dev/null | xargs -I{} basename {} | wc -l | tr -d ' ')
echo "  (actual skill directories with SKILL.md: $ACTUAL_SKILLS)"

# Matches "| **Skills** | 28 |" in README.md
README_SKILLS=$(extract_bold_table_value "README.md" "Skills")
if [ -z "$README_SKILLS" ]; then README_SKILLS="0"; fi
if [ "$README_SKILLS" = "$ACTUAL_SKILLS" ]; then
  pass "README.md component table: $README_SKILLS"
else
  fail "README.md component table: found $README_SKILLS, expected $ACTUAL_SKILLS"
fi

# 1.4 Memory count
echo ""
echo "--- 1.4 Sub-agent memory count ---"
ACTUAL_MEMORIES=$(ls $AOS/sub-agents/memories/*.md 2>/dev/null | grep -v README | wc -l | tr -d ' ')
echo "  (actual memory files: $ACTUAL_MEMORIES)"

# Matches "| **Memories** | 6 |" in README.md
README_MEMORIES=$(extract_bold_table_value "README.md" "Memories")
if [ -z "$README_MEMORIES" ]; then README_MEMORIES="0"; fi
if [ "$README_MEMORIES" = "$ACTUAL_MEMORIES" ]; then
  pass "README.md component table: $README_MEMORIES"
else
  fail "README.md component table: found $README_MEMORIES, expected $ACTUAL_MEMORIES"
fi

# ── Section 2: Codebase Metrics Consistency ──

echo ""
echo "=== Section 2: Codebase Metrics (STATE.md vs reality) ==="

check_metric() {
  local label="$1" actual="$2" file="$3" row_label="$4"
  local found
  found=$(extract_table_value "$file" "$row_label")
  if [ -z "$found" ]; then
    warn "$label: row '$row_label' not found in $file"
  elif [ "$found" = "$actual" ]; then
    pass "$label: $found"
  else
    fail "$label: $file says $found, actual is $actual"
  fi
}

ACTUAL_BACKEND_MODULES=$(ls -d src/backend/src/modules/*/ 2>/dev/null | wc -l | tr -d ' ')
ACTUAL_SERVICES=$(find src/backend/src/modules -name '*-service.ts' 2>/dev/null | wc -l | tr -d ' ')
ACTUAL_ROUTES=$(find src/backend/src/modules -name 'routes.ts' 2>/dev/null | wc -l | tr -d ' ')
ACTUAL_PAGES=$(find src/frontend/src/pages/admin -name '*.tsx' ! -path '*__tests__*' ! -name '*.test.tsx' 2>/dev/null | wc -l | tr -d ' ')
ACTUAL_TYPES=$(find src/shared/src/types -name '*.ts' ! -name 'index.ts' 2>/dev/null | wc -l | tr -d ' ')
ACTUAL_TESTS=$(find src -name '*.test.ts' -o -name '*.test.tsx' 2>/dev/null | wc -l | tr -d ' ')
ACTUAL_DOCS=$(find docs -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
ACTUAL_COLLECTIONS=$(grep -oE 'grc_[a-z_]+' src/backend/src/db/indexes.ts 2>/dev/null | sort -u | wc -l | tr -d ' ')

echo ""
check_metric "Backend modules" "$ACTUAL_BACKEND_MODULES" "$AOS/STATE.md" "Backend modules"
check_metric "Backend services" "$ACTUAL_SERVICES" "$AOS/STATE.md" "Backend services"
check_metric "Route files" "$ACTUAL_ROUTES" "$AOS/STATE.md" "Route files"
check_metric "Frontend pages" "$ACTUAL_PAGES" "$AOS/STATE.md" "Frontend admin pages"
check_metric "Shared types" "$ACTUAL_TYPES" "$AOS/STATE.md" "Shared type files"
check_metric "Test files" "$ACTUAL_TESTS" "$AOS/STATE.md" "Test files"
check_metric "Documentation" "$ACTUAL_DOCS" "$AOS/STATE.md" "Documentation files"
check_metric "Collections" "$ACTUAL_COLLECTIONS" "$AOS/STATE.md" "MongoDB collections"

# ── Section 3: Phase Consistency ──

echo ""
echo "=== Section 3: Phase Consistency ==="

# Check that STATE.md and CLAUDE.md agree on active phase
# STATE.md: "| **Active phase** | 21 — ..."
STATE_PHASE=$(grep 'Active phase' $AOS/STATE.md 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "?")
# CLAUDE.md: "Phase 21 (Module Review..."
CLAUDE_PHASE=$(grep -oE 'Phase [0-9]+' CLAUDE.md 2>/dev/null | tail -1 | grep -oE '[0-9]+' || echo "?")
echo ""
if [ "$STATE_PHASE" = "$CLAUDE_PHASE" ]; then
  pass "Active phase: STATE.md ($STATE_PHASE) matches CLAUDE.md ($CLAUDE_PHASE)"
else
  fail "Active phase mismatch: STATE.md says $STATE_PHASE, CLAUDE.md says $CLAUDE_PHASE"
fi

# Check phase directory count vs STATE.md row count
PHASE_DIRS=$(ls -d docs/product/phases/phase-*/ 2>/dev/null | wc -l | tr -d ' ')
STATE_ROWS=$(grep -cE '^\| [0-9]+ \|' $AOS/STATE.md 2>/dev/null || echo "0")
if [ "$PHASE_DIRS" = "$STATE_ROWS" ]; then
  pass "Phase directories ($PHASE_DIRS) match STATE.md rows ($STATE_ROWS)"
else
  fail "Phase directories ($PHASE_DIRS) != STATE.md rows ($STATE_ROWS)"
fi

# Sprint 46.6.8 — orchestrator pickup processor must exist + be executable.
echo ""
echo "--- 46.6.8 Orchestrator pickup ---"
PROC="$AOS/scripts/process-spawn-requests.sh"
PROC_MJS="$AOS/scripts/process-spawn-requests.mjs"
if [ -f "$PROC" ] && [ -x "$PROC" ] && [ -f "$PROC_MJS" ]; then
  pass "process-spawn-requests.{sh,mjs} present and executable"
else
  fail "process-spawn-requests.{sh,mjs} missing or not executable"
fi

# Sprint 46.6.9 — automation infrastructure must exist + be executable.
echo ""
echo "--- 46.6.9 Memory v2 automation ---"
POST_MERGE=".husky/post-merge"
if [ -f "$POST_MERGE" ] && [ -x "$POST_MERGE" ]; then
  pass ".husky/post-merge auto-trigger present"
else
  fail ".husky/post-merge missing or not executable"
fi

DAILY="$AOS/scheduled/process-spawn-requests-daily.sh"
if [ -f "$DAILY" ] && [ -x "$DAILY" ]; then
  pass "scheduled daily fallback present"
else
  fail "scheduled daily fallback missing"
fi

ARCHIVE="$AOS/scripts/archive-consumed.sh"
if [ -f "$ARCHIVE" ] && [ -x "$ARCHIVE" ]; then
  pass "archive-consumed.sh present"
else
  fail "archive-consumed.sh missing"
fi

# Sprint 46.6.7 — every key/value in diary-routing.yaml is a real agent.
echo ""
echo "--- 46.6.7 Diary routing config ---"
ROUTING="$AOS/sub-agents/diary-routing.yaml"
if [ -f "$ROUTING" ]; then
  ROUTING_BAD=0
  KNOWN_AGENTS=$(ls $AOS/sub-agents/agents/*.md 2>/dev/null | xargs -I{} basename {} .md | sort -u)
  while IFS= read -r line; do
    # strip comment + trim
    rule=$(echo "$line" | sed 's/#.*$//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -z "$rule" ] && continue
    # parse key
    key=$(echo "$rule" | sed -nE 's/^([a-z][a-z0-9-]+)[[:space:]]*:.*$/\1/p')
    [ -z "$key" ] && continue
    if ! echo "$KNOWN_AGENTS" | grep -qx "$key"; then
      fail "diary-routing.yaml key '$key' is not a known agent"
      ROUTING_BAD=$((ROUTING_BAD + 1))
    fi
    # parse values (peer list or "*")
    val=$(echo "$rule" | sed -E "s/^[a-z][a-z0-9-]+[[:space:]]*:[[:space:]]*//")
    if [ "$val" = "\"*\"" ] || [ "$val" = "*" ]; then continue; fi
    peers=$(echo "$val" | sed -E 's/^\[//;s/\]$//' | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' || true)
    while IFS= read -r peer; do
      [ -z "$peer" ] && continue
      if ! echo "$KNOWN_AGENTS" | grep -qx "$peer"; then
        fail "diary-routing.yaml: '$key' routes to unknown agent '$peer'"
        ROUTING_BAD=$((ROUTING_BAD + 1))
      fi
    done <<< "$peers"
  done < "$ROUTING"
  if [ "$ROUTING_BAD" -eq 0 ]; then
    pass "All diary-routing.yaml entries reference known agents"
  fi
else
  warn "diary-routing.yaml not found (Sprint 46.6.7) — Routed Diaries injection disabled"
fi

# Sprint 46.6.2 — every agent listed in SUB-AGENTS.md has a diary.md, and
# every lessons/<file>.md matches the <sprint-id>.md pattern.
echo ""
echo "--- 46.6.2 Per-agent diaries ---"
DIARY_MISSING=0
for agent_md in $AOS/sub-agents/agents/*.md; do
  name=$(basename "$agent_md" .md)
  diary="$AOS/sub-agents/${name}/diary.md"
  if [ ! -f "$diary" ]; then
    fail "missing diary: $diary"
    DIARY_MISSING=$((DIARY_MISSING + 1))
  fi
done
if [ "$DIARY_MISSING" -eq 0 ]; then
  pass "All 30 agents have diary.md"
fi

LESSON_BAD=0
for lesson in $AOS/sub-agents/*/lessons/*.md; do
  [ -f "$lesson" ] || continue
  fname=$(basename "$lesson" .md)
  # Sprint-id pattern: digits.dot.digits[.digits[.digits]]  (e.g. 46.0.0, 46.2.0, 11.0.0, 22.7.0)
  if ! echo "$fname" | grep -qE '^[0-9]+\.[0-9]+(\.[0-9]+){1,3}$'; then
    fail "lesson filename does not match <sprint-id>.md pattern: $lesson"
    LESSON_BAD=$((LESSON_BAD + 1))
  fi
done
if [ "$LESSON_BAD" -eq 0 ]; then
  pass "All per-agent lesson files match the <sprint-id>.md pattern"
fi

# Sprint 46.6.1 — facts.jsonl parses cleanly and is non-empty after seeding.
echo ""
echo "--- 46.6.1 Temporal facts ledger ---"
FACTS="$AOS/facts.jsonl"
if [ -f "$FACTS" ]; then
  if bash "$AOS/scripts/facts-rebuild.sh" >/dev/null 2>&1; then
    FACT_COUNT=$(wc -l < "$FACTS" | tr -d ' ')
    pass "facts.jsonl parses cleanly ($FACT_COUNT triples)"
  else
    fail "facts.jsonl failed parse — run: bash $AOS/scripts/facts-rebuild.sh"
  fi
else
  fail "facts.jsonl missing — run: bash $AOS/scripts/facts-seed-from-rules.sh"
fi

# Sprint 46.6.0 — INDEX.aaak.jsonl entry count must match the live H2/H3
# header count in the memory corpus. Catches (a) a stale INDEX that wasn't
# regenerated and (b) a corpus header added without rebuilding the index.
echo ""
echo "--- 46.6.0 AAAK memory index ---"
INDEX_JSONL="$AOS/memories/INDEX.aaak.jsonl"
if [ -f "$INDEX_JSONL" ]; then
  INDEX_ENTRIES=$(wc -l < "$INDEX_JSONL" | tr -d ' ')
  # Sprint 46.6.2: per-agent lessons dirs are also indexed.
  # Sprint 46.6.9: per-agent diary.md files are also indexed when they
  # contain real content (the placeholder marker is skipped by the walker).
  DIARY_HEADERS=$(for d in $AOS/sub-agents/*/diary.md; do
    [ -f "$d" ] || continue
    grep -q '<!-- diary will be appended by post-sprint-memory.sh -->' "$d" && continue
    grep -cE '^#{2,3} ' "$d"
  done | awk '{sum+=$1} END {print sum+0}')
  CORPUS_HEADERS=$(find \
      $AOS/memories \
      $AOS/sub-agents/memories \
      $AOS/sub-agents/*/lessons \
      -maxdepth 2 -name '*.md' -type f 2>/dev/null \
    | xargs -I{} grep -hcE '^#{2,3} ' {} 2>/dev/null \
    | awk -v diary="$DIARY_HEADERS" '{sum+=$1} END {print sum + diary}')
  # The build script skips every README.md it walks past — subtract their
  # headers from the corpus tally regardless of depth.
  README_HEADERS=$(find \
      $AOS/memories \
      $AOS/sub-agents/memories \
      $AOS/sub-agents/*/lessons \
      -maxdepth 2 -name 'README.md' -type f 2>/dev/null \
    | xargs -I{} grep -hcE '^#{2,3} ' {} 2>/dev/null \
    | awk '{sum+=$1} END {print sum+0}')
  EXPECTED_HEADERS=$((CORPUS_HEADERS - README_HEADERS))
  if [ "$INDEX_ENTRIES" = "$EXPECTED_HEADERS" ]; then
    pass "INDEX.aaak.jsonl entries ($INDEX_ENTRIES) match corpus headers ($EXPECTED_HEADERS)"
  else
    fail "INDEX.aaak.jsonl entries ($INDEX_ENTRIES) ≠ corpus headers ($EXPECTED_HEADERS) — run: bash $AOS/scripts/build-memory-index.sh"
  fi
else
  fail "INDEX.aaak.jsonl missing — run: bash $AOS/scripts/build-memory-index.sh"
fi

# ── Summary ──

echo ""
echo "==============================="
if [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo "All housekeeping checks passed."
elif [ "$ERRORS" -eq 0 ]; then
  echo "$WARNINGS warning(s), 0 errors."
else
  echo "$ERRORS ERROR(S), $WARNINGS warning(s)."
fi
echo "==============================="

exit "$ERRORS"
