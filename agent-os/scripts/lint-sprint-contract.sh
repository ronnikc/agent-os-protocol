#!/usr/bin/env bash
# lint-sprint-contract.sh — Validates sprint spec contract completeness (Step A + planning quality)
#
# Unlike lint-sprint-spec.sh (Gate -2, implementation-oriented checks),
# this script checks that the PLANNING structure is complete:
# - Step A contract elements (Goal, ACs, Out of Scope, Dependencies, Affected Modules)
# - Agent Assignment table
# - Work Breakdown section
# - Risk Assessment section
#
# These checks apply to ALL sprint types (implementation, cleanup, doc-only, fix).
#
# Usage: bash agent-os/scripts/lint-sprint-contract.sh <sprint-spec-file.md>
# Exit code 0 = all checks pass
# Exit code 1 = one or more checks failed
#
# Created: 2026-03-23 (Sprint planning quality hooks)

set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 <sprint-spec-file.md>"
  exit 1
fi

FILE="$1"

if [ ! -f "$FILE" ]; then
  echo "ERROR: File not found: $FILE"
  exit 1
fi

# Skip workfiles
if echo "$FILE" | grep -q -- '-workfile\.md$'; then
  exit 0
fi

PASS=0
FAIL=0
CHECKS=0

check_section() {
  local check_id="$1"
  local description="$2"
  local pattern="$3"
  local required="${4:-true}"

  CHECKS=$((CHECKS + 1))

  if grep -qiE "$pattern" "$FILE"; then
    echo "  ✓ $check_id: $description"
    PASS=$((PASS + 1))
    return 0
  else
    if [ "$required" = "true" ]; then
      echo "  ✗ $check_id: $description — MISSING"
      FAIL=$((FAIL + 1))
    else
      echo "  ⚠ $check_id: $description — recommended but not required"
    fi
    return 1
  fi
}

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  SPRINT CONTRACT QUALITY CHECK               ║"
echo "║  File: $(basename "$FILE")"
echo "╚══════════════════════════════════════════════╝"

# ── Header metadata ──────────────────────────────────────────
echo ""
echo "── Header Metadata ──"

check_section "H1" "Phase declared" "^\*\*Phase:\*\*|^Phase:"
check_section "H2" "Status declared" "^\*\*Status:\*\*|^Status:"
check_section "H3" "Created date" "^\*\*Created:\*\*|^Created:"
check_section "H4" "Priority declared" "^\*\*Priority:\*\*|^Priority:"

# ── Step A: Sprint Contract ──────────────────────────────────
echo ""
echo "── Step A: Sprint Contract ──"

check_section "A1" "Goal section" "^#+ *Goal"
check_section "A2" "Acceptance Criteria section" "^#+ *Acceptance Criteria"

# A2b: ACs should have numbered or bulleted items
if grep -qiE '^#+ *Acceptance Criteria' "$FILE"; then
  # Look for numbered items (1. 2. 3.) or checkboxes (- [ ]) or bullets (- **) after the AC heading
  AC_LINE=$(grep -n -iE '^#+ *Acceptance Criteria' "$FILE" | head -1 | cut -d: -f1)
  if [ -n "$AC_LINE" ]; then
    # Check next 30 lines for numbered/bulleted items
    ITEMS=$(tail -n "+$AC_LINE" "$FILE" | head -30 | grep -cE '^\s*[0-9]+\.|^\s*-\s*\[|^\s*-\s*\*\*' || true)
    CHECKS=$((CHECKS + 1))
    if [ "$ITEMS" -ge 3 ]; then
      echo "  ✓ A2b: Acceptance Criteria has $ITEMS items (minimum 3)"
      PASS=$((PASS + 1))
    elif [ "$ITEMS" -ge 1 ]; then
      echo "  ⚠ A2b: Acceptance Criteria has only $ITEMS items (recommend 3-10)"
      # Don't fail, just warn
    else
      echo "  ✗ A2b: Acceptance Criteria section exists but has no numbered/bulleted items"
      FAIL=$((FAIL + 1))
    fi
  fi
fi

check_section "A3" "Out of Scope section" "^#+ *Out of Scope"

# A3b: Out of Scope should have 3-column table
if grep -qiE '^#+ *Out of Scope' "$FILE"; then
  CHECKS=$((CHECKS + 1))
  if grep -qE '\| *Item *\| *Classification *\| *Action *\|' "$FILE"; then
    echo "  ✓ A3b: Out of Scope has 3-column table (Item|Classification|Action)"
    PASS=$((PASS + 1))
  else
    echo "  ✗ A3b: Out of Scope missing 3-column table (Item|Classification|Action)"
    FAIL=$((FAIL + 1))
  fi
fi

check_section "A4" "Dependencies section" "^#+ *Dependencies|^\*\*Dependencies:\*\*|Dependencies:.*None|Dependencies:.*Sprint"

check_section "A5" "Affected Modules section" "^#+ *Affected Modules|^#+ *Affected"

# ── Planning Quality ─────────────────────────────────────────
echo ""
echo "── Planning Quality ──"

check_section "P1" "Work Breakdown section" "^#+ *Work Breakdown|^#+ *Batch [0-9]|^### *Batch"

check_section "P2" "Agent Assignment table" "^#+ *Agent Assignment|Lead Agent.*Reviewer|Lead.*Agent"

check_section "P3" "Risk Assessment section" "^#+ *Risk Assessment|^#+ *Risk" "false"

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "────────────────────────────────"
echo "Contract Check: $PASS/$CHECKS passed, $FAIL failed"
echo "────────────────────────────────"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Sprint spec is incomplete. Add missing sections before committing."
  exit 1
fi

echo ""
echo "Sprint contract is complete."
exit 0
