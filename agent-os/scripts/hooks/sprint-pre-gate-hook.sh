#!/bin/bash
# agent-os/scripts/hooks/sprint-pre-gate-hook.sh
# PostToolUse hook on Read: Runs pre-implementation gate when a sprint spec is read.
#
# Triggers when file_path matches: docs/product/phases/phase-*/sprint-*.md
# Excludes workfiles (sprint-*-workfile.md) and README files.
#
# Input: JSON via stdin from Claude Code hook system
#   { "tool_name": "Read", "tool_input": { "file_path": "..." }, ... }
# Exit: 0 always (advisory — does not block the read)
# Stdout: Gate results injected as context to the agent
#
# Created: 2026-03-23 (Hook-enforced sprint gates)

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

# This is a sprint spec — run the pre-implementation gate
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  SPRINT PRE-IMPLEMENTATION GATE (Hook-Enforced)"
echo "  Triggered by reading: $REL_PATH"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Try to find a matching workfile
SPEC_DIR=$(dirname "$FILE_PATH")
SPEC_BASE=$(basename "$FILE_PATH" .md)
WORKFILE="${SPEC_DIR}/${SPEC_BASE}-workfile.md"

if [ -f "$WORKFILE" ]; then
  WORKFILE_ARG="$WORKFILE"
else
  WORKFILE_ARG=""
fi

# Run the gate runner
cd "$REPO_ROOT"
if bash agent-os/scripts/sprint-gate-runner.sh --pre "$FILE_PATH" $WORKFILE_ARG 2>&1; then
  echo ""
  echo "✓ Pre-implementation gate PASSED. Proceed with implementation."
else
  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "  ✗ PRE-IMPLEMENTATION GATE FAILED"
  echo ""
  echo "  You MUST fix the issues above before writing any code."
  echo "  Re-read the sprint spec after fixing to re-trigger this gate."
  echo "══════════════════════════════════════════════════════════════"
fi

# Always exit 0 — this is advisory, not blocking
# The agent sees the output and must act on failures
exit 0
