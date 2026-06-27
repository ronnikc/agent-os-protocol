#!/bin/bash
# agent-os/scripts/hooks/sprint-spec-quality-hook.sh
# PostToolUse hook on Write/Edit: Immediate quality feedback when writing sprint specs.
#
# Runs two validation layers:
#   1. lint-sprint-contract.sh — Step A contract completeness (Goal, ACs, Out of Scope, etc.)
#   2. lint-sprint-spec.sh    — Gate -2 structural checks (C.1, C.2, accessibility, etc.)
#
# Advisory only (exit 0 always) — gives the agent immediate feedback so it can
# iterate on the spec before committing. The blocking enforcement stays at
# commit time (sprint-spec-lint-on-commit.sh).
#
# Input: JSON via stdin from Claude Code hook system
#   Write: { "tool_name": "Write", "tool_input": { "file_path": "..." }, ... }
#   Edit:  { "tool_name": "Edit", "tool_input": { "file_path": "..." }, ... }
# Exit: 0 always (advisory)
# Stdout: Quality check results injected as context to the agent
#
# Created: 2026-03-23 (Sprint planning quality hooks)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Read JSON from stdin, extract file_path
INPUT=$(cat) || true
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || true

# If we can't extract the path, skip
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Normalize to relative path from repo root
REL_PATH="${FILE_PATH#"$REPO_ROOT"/}"

# Check if this is a sprint spec file (not a workfile, not a README)
if ! echo "$REL_PATH" | grep -qP '^docs/product/phases/phase-\d+/sprint-.*\.md$'; then
  exit 0
fi

# Exclude workfiles
if echo "$REL_PATH" | grep -q -- '-workfile\.md$'; then
  exit 0
fi

# Exclude README files
if echo "$REL_PATH" | grep -qi 'README'; then
  exit 0
fi

# This is a sprint spec — run quality checks
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  SPRINT SPEC QUALITY CHECK (Immediate Feedback)"
echo "  File: $REL_PATH"
echo "═══════════════════════════════════════════════════════════════"

cd "$REPO_ROOT"

CONTRACT_PASS=true
GATE2_PASS=true

# Layer 1: Step A contract completeness
CONTRACT_SCRIPT="agent-os/scripts/lint-sprint-contract.sh"
if [ -f "$CONTRACT_SCRIPT" ]; then
  if ! bash "$CONTRACT_SCRIPT" "$FILE_PATH" 2>&1; then
    CONTRACT_PASS=false
  fi
else
  echo "  ⚠ Contract lint script not found: $CONTRACT_SCRIPT"
fi

# Layer 2: Gate -2 structural checks
GATE2_SCRIPT="agent-os/scripts/lint-sprint-spec.sh"
if [ -f "$GATE2_SCRIPT" ]; then
  echo ""
  echo "── Gate -2: Structural Checks ──"
  if ! bash "$GATE2_SCRIPT" "$FILE_PATH" 2>&1; then
    GATE2_PASS=false
  fi
else
  echo "  ⚠ Gate -2 lint script not found: $GATE2_SCRIPT"
fi

# Summary
echo ""
if [ "$CONTRACT_PASS" = true ] && [ "$GATE2_PASS" = true ]; then
  echo "✓ Sprint spec passes all quality checks. Ready to commit."
else
  echo "══════════════════════════════════════════════════════════════"
  if [ "$CONTRACT_PASS" = false ]; then
    echo "  ✗ CONTRACT: Missing required sections (see above)"
  fi
  if [ "$GATE2_PASS" = false ]; then
    echo "  ✗ GATE -2: Structural checks failed (see above)"
  fi
  echo ""
  echo "  Fix the issues above. The spec will be re-checked on next edit."
  echo "  The commit hook will BLOCK if these issues are not resolved."
  echo "══════════════════════════════════════════════════════════════"
fi

# Always exit 0 — advisory only
exit 0
