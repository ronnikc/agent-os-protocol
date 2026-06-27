#!/usr/bin/env bash
# lint-sprint-spec.sh — Validates sprint spec structure against Gate -2 (SPRINTS.md Step A.-1)
#
# Usage: bash agent-os/scripts/lint-sprint-spec.sh <sprint-spec-file.md>
#        bash agent-os/scripts/lint-sprint-spec.sh docs/product/phases/phase-21/sprint-25.3.1.md
#
# Exit code 0 = all checks pass
# Exit code 1 = one or more checks failed
#
# Created: 2026-03-17 (R-27 / Gate -2 enforcement)

set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 <sprint-spec-file.md> [<sprint-spec-file2.md> ...]"
  echo "       $0 docs/product/phases/phase-21/sprint-*.md"
  exit 1
fi

PASS=0
FAIL=0
WARN=0
TOTAL_FILES=0

check() {
  local file="$1"
  local check_num="$2"
  local description="$3"
  local pattern="$4"
  local na_pattern="${5:-}"

  if grep -qiE "$pattern" "$file"; then
    echo "  ✓ Check $check_num: $description"
    return 0
  elif [ -n "$na_pattern" ] && grep -qiE "$na_pattern" "$file"; then
    echo "  ✓ Check $check_num: $description (N/A documented)"
    return 0
  else
    echo "  ✗ Check $check_num: $description — MISSING"
    return 1
  fi
}

for FILE in "$@"; do
  if [ ! -f "$FILE" ]; then
    echo "ERROR: File not found: $FILE"
    ((FAIL++))
    continue
  fi

  # Skip sub-sprint files (X.Y.Z.N pattern) — they have lighter requirements
  BASENAME=$(basename "$FILE" .md)
  if echo "$BASENAME" | grep -qE 'sprint-[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+'; then
    echo "SKIP: $FILE (sub-sprint — lighter requirements)"
    continue
  fi

  # fix-sprint-20260411-0417 Finding 36 — fix-sprint specs are
  # auto-generated quality reports, not phase sprint specs. They use a
  # different structure (Findings instead of Epics, no API trace, no
  # form completeness gate). Skip the structural checks for them; the
  # extended hook still validates them via a separate code path if
  # added in the future. For now treat them as exempt with a banner.
  if echo "$FILE" | grep -qE 'docs/product/fix-sprints/fix-sprint-.*\.md'; then
    echo "SKIP: $FILE (fix-sprint — auto-generated quality report, lighter checks not yet implemented)"
    continue
  fi

  TOTAL_FILES=$((TOTAL_FILES + 1))
  FILE_FAILS=0
  echo ""
  echo "=== Checking: $FILE ==="

  # Common N/A signals for non-implementation sprints (cleanup, refactor, doc-only, tech debt)
  NA_COMMON="N/A.*no API|N/A.*no endpoint|N/A.*no new|N/A.*cleanup|N/A.*refactor|N/A.*technical debt|N/A.*no logic|N/A.*no behavioral|N/A.*mechanical|No behavioral changes|No logic changes|only unused variable"

  # Check 1: C.1 API Contract Trace section
  if ! check "$FILE" 1 "C.1 API Contract Trace" "API Contract Trace|C\.1.*trace|mount point.*grep|Route path.*read" "$NA_COMMON|N/A.*infrastructure|C\.1.*N/A|Form Completeness Gate.*N/A"; then
    FILE_FAILS=$((FILE_FAILS + 1))
  fi

  # Check 2: C.2 Form Completeness Gate section
  if ! check "$FILE" 2 "C.2 Form Completeness Gate" "Form Completeness Gate|C\.2.*gate|Entity reference check|Required field check|Button state check" "$NA_COMMON|N/A.*no forms|C\.2.*N/A|Form Completeness.*N/A"; then
    FILE_FAILS=$((FILE_FAILS + 1))
  fi

  # Check 3: Accessibility section with specific checks
  if ! check "$FILE" 3 "Accessibility section" "Accessibility.*MANDATORY|B[5-8].*Accessibility|Accessibility Specialist review|WCAG|keyboard.navigable|aria-|focus trap|AccessibleModal" "$NA_COMMON|N/A.*no frontend|N/A.*no UI|Accessibility.*N/A"; then
    FILE_FAILS=$((FILE_FAILS + 1))
  fi

  # Check 4: Accessibility Specialist in agent table
  if ! check "$FILE" 4 "Accessibility Specialist as agent" "Accessibility Specialist" "N/A.*no frontend|N/A.*no UI"; then
    FILE_FAILS=$((FILE_FAILS + 1))
  fi

  # Check 5: 3-column Out of Scope table (Item | Classification | Action)
  if grep -qE '\| *Item *\| *Classification *\| *Action *\|' "$FILE"; then
    echo "  ✓ Check 5: Out of Scope 3-column table (Item|Classification|Action)"
  elif grep -qE '\| *Item *\| *Classification *\| *Rationale *\|' "$FILE"; then
    echo "  ✗ Check 5: Out of Scope table has 'Rationale' instead of 'Action' column — needs 3-column format with Action"
    FILE_FAILS=$((FILE_FAILS + 1))
  elif grep -qiE 'out of scope' "$FILE"; then
    echo "  ✗ Check 5: Out of Scope section exists but missing 3-column table (Item|Classification|Action)"
    FILE_FAILS=$((FILE_FAILS + 1))
  else
    echo "  ✗ Check 5: Out of Scope section — MISSING entirely"
    FILE_FAILS=$((FILE_FAILS + 1))
  fi

  # Check 6: Sub-sprint numbers for deferred improvements
  if grep -qiE 'Deferred improvement' "$FILE"; then
    if grep -qEi 'Sub-sprint [0-9]+\.[0-9]+\.[0-9]+|[Ss]ub-sprint [0-9]+\.[0-9]+\.[0-9]+\.[0-9]+|\*\*Sub-sprint' "$FILE"; then
      echo "  ✓ Check 6: Deferred improvements have sub-sprint numbers"
    else
      echo "  ✗ Check 6: Deferred improvements found but NO sub-sprint numbers assigned (A.1 violation)"
      FILE_FAILS=$((FILE_FAILS + 1))
    fi
  else
    echo "  ✓ Check 6: No deferred improvements (sub-sprint check N/A)"
  fi

  # Check 7: Pagination unwrap (R-23)
  if ! check "$FILE" 7 "Pagination unwrap (R-23)" "R-23|paginated|pagination.*unwrap|\.data \?\? \[\]|\(res as any\)\.data" "$NA_COMMON|N/A.*no paginated|no paginated endpoint"; then
    FILE_FAILS=$((FILE_FAILS + 1))
  fi

  # Check 8: Error parsing pattern
  if ! check "$FILE" 8 "Error parsing pattern" "err\?\.response|error\.message|toast\.error|Operation failed|error.*pars" "$NA_COMMON"; then
    FILE_FAILS=$((FILE_FAILS + 1))
  fi

  # Check 9: Button loading state pattern
  if ! check "$FILE" 9 "Button loading/disabled state" "disabled.*saving|disabled.*loading|setSaving|button.*state|loading.*disabled|disabled={" "$NA_COMMON|N/A.*no forms|N/A.*no buttons"; then
    FILE_FAILS=$((FILE_FAILS + 1))
  fi

  # Summary for this file
  if [ "$FILE_FAILS" -eq 0 ]; then
    echo "  → PASS (all 9 checks)"
    PASS=$((PASS + 1))
  else
    echo "  → FAIL ($FILE_FAILS checks failed)"
    FAIL=$((FAIL + 1))
  fi
done

# Final summary
echo ""
echo "================================"
echo "Gate -2 Sprint Spec Lint Summary"
echo "================================"
echo "Files checked: $TOTAL_FILES"
echo "Passed: $PASS"
echo "Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "BLOCKED: $FAIL spec(s) failed Gate -2. Fix missing sections before committing."
  exit 1
else
  echo ""
  echo "All specs pass Gate -2."
  exit 0
fi
