#!/bin/bash
# agent-os/scripts/runtime-verify.sh
# Runtime verification script: Runs all quality checks in sequence.
# Designed to be called by the runtime-verification skill or pre-commit hook.
#
# Usage: bash agent-os/scripts/runtime-verify.sh [--quick | --full]
#   --quick: type-check only (fast, ~10s)
#   --full:  type-check + lint + tests + security scan (~3-5 min)
# Exit: 0 = all pass, 1 = failures found

set -euo pipefail

MODE="${1:---quick}"
FAILURES=0

echo "=== Runtime Verification ($MODE) ==="
echo ""

# Step 1: Build shared (always required — R-01)
echo "[1] Building shared types..."
if npx tsc -p src/shared/tsconfig.json 2>/dev/null; then
  echo "    PASS: shared"
else
  echo "    FAIL: shared does not compile"
  FAILURES=$((FAILURES + 1))
fi

# Step 2: Type-check backend
echo "[2] Type-checking backend..."
if npx tsc -p src/backend/tsconfig.json --noEmit 2>/dev/null; then
  echo "    PASS: backend"
else
  echo "    FAIL: backend has type errors"
  FAILURES=$((FAILURES + 1))
fi

# Step 3: Type-check frontend
echo "[3] Type-checking frontend..."
if npx tsc -p src/frontend/tsconfig.json --noEmit 2>/dev/null; then
  echo "    PASS: frontend"
else
  echo "    FAIL: frontend has type errors"
  FAILURES=$((FAILURES + 1))
fi

if [ "$MODE" = "--quick" ]; then
  echo ""
  if [ $FAILURES -eq 0 ]; then
    echo "=== Quick Verification: PASSED ==="
  else
    echo "=== Quick Verification: FAILED ($FAILURES issues) ==="
  fi
  exit $FAILURES
fi

# Full mode continues below

# Step 4: Lint
echo "[4] Running linter..."
if npm run lint 2>/dev/null; then
  echo "    PASS: lint"
else
  echo "    FAIL: lint errors found"
  FAILURES=$((FAILURES + 1))
fi

# Step 5: Tests
echo "[5] Running tests..."
if npm run test:all 2>/dev/null; then
  echo "    PASS: tests"
else
  echo "    FAIL: test failures"
  FAILURES=$((FAILURES + 1))
fi

# Step 6: Security audit
echo "[6] Running security audit..."
if npm audit --audit-level=high 2>/dev/null; then
  echo "    PASS: no high/critical vulnerabilities"
else
  echo "    WARN: vulnerabilities found (check npm audit output)"
  # Don't increment failures — audit warnings are advisory
fi

# Step 7: Governance lint
echo "[7] Running governance lint..."
if bash agent-os/scripts/lint-housekeeping.sh 2>/dev/null; then
  echo "    PASS: housekeeping"
else
  echo "    WARN: housekeeping issues (check lint output)"
fi

echo ""
if [ $FAILURES -eq 0 ]; then
  echo "=== Full Verification: PASSED ==="
else
  echo "=== Full Verification: FAILED ($FAILURES issues) ==="
fi

exit $FAILURES
