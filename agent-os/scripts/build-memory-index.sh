#!/usr/bin/env bash
# build-memory-index.sh — regenerate the AAAK memory index.
#
# Sprint 46.6.0 — Agent OS Memory v2: Memory Index + Layered Load.
# Walks agent-os/memories/**/*.md and agent-os/sub-agents/memories/**/*.md,
# extracts headers + first sentences, emits:
#   agent-os/memories/INDEX.aaak.jsonl   (committed source of truth)
#   agent-os/memories/INDEX.aaak         (generated, gitignored, compressed)
#
# Idempotent: re-run produces byte-identical output on unchanged inputs.
# Honors the bash + jq + node baseline (no Python).
#
# Usage:  bash agent-os/scripts/build-memory-index.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "build-memory-index: node is required (banned: python; allowed: bash + jq + node)" >&2
  exit 2
fi

node agent-os/scripts/build-memory-index.mjs

# Verify the JSONL is well-formed.
# Prefer jq (CI baseline) and fall back to node when jq isn't installed.
if command -v jq >/dev/null 2>&1; then
  if ! jq -c . agent-os/memories/INDEX.aaak.jsonl >/dev/null; then
    echo "build-memory-index: INDEX.aaak.jsonl failed jq parse" >&2
    exit 3
  fi
else
  if ! node -e '
    const fs = require("node:fs");
    const lines = fs.readFileSync("agent-os/memories/INDEX.aaak.jsonl", "utf8").split("\n").filter(Boolean);
    for (const ln of lines) JSON.parse(ln);
  '; then
    echo "build-memory-index: INDEX.aaak.jsonl failed node JSON parse" >&2
    exit 3
  fi
fi
