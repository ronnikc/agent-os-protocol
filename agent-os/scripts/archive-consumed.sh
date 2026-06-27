#!/usr/bin/env bash
# archive-consumed.sh — collapse old consumed/ spawn-requests into a monthly JSONL archive.
#
# Sprint 46.6.9 — Part D item 4. Without retention the consumed/ directory
# grows by one file per sprint forever.
#
# Behavior:
#   - For each .claude/spawn-requests/consumed/post-sprint-memory-*.json
#     older than --age-days (default 30):
#       1. Append its content as a single JSONL line to
#          agent-os/spawn-requests-archive/<YYYY-MM>.jsonl
#          (where <YYYY-MM> is the file's processed_at month)
#       2. Delete the original
#   - Idempotent — files already archived (i.e. no longer in consumed/)
#     are not touched.
#
# Usage:  bash agent-os/scripts/archive-consumed.sh [--age-days N]

set -euo pipefail

AGE_DAYS=30
while [ $# -gt 0 ]; do
  case "$1" in
    --age-days) AGE_DAYS="$2"; shift 2 ;;
    *) echo "archive-consumed: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

CONSUMED=".claude/spawn-requests/consumed"
ARCHIVE_DIR="agent-os/spawn-requests-archive"
mkdir -p "$ARCHIVE_DIR"

if [ ! -d "$CONSUMED" ]; then
  echo "archive-consumed: no consumed/ dir — nothing to archive."
  exit 0
fi

AGE_DAYS="$AGE_DAYS" CONSUMED="$CONSUMED" ARCHIVE_DIR="$ARCHIVE_DIR" \
  node --input-type=module -e '
import { readdirSync, readFileSync, statSync, appendFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ageDays = parseInt(process.env.AGE_DAYS, 10);
const consumedDir = process.env.CONSUMED;
const archiveDir  = process.env.ARCHIVE_DIR;
const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;

let archived = 0;
let skipped = 0;
for (const fname of readdirSync(consumedDir).sort()) {
  if (!fname.startsWith("post-sprint-memory-") || !fname.endsWith(".json")) continue;
  const fp = join(consumedDir, fname);
  const st = statSync(fp);
  if (st.mtimeMs > cutoff) { skipped++; continue; }

  let content;
  try { content = readFileSync(fp, "utf8"); } catch { skipped++; continue; }

  // Derive monthly bucket from processed_at if present, else mtime
  let month;
  try {
    const parsed = JSON.parse(content);
    const ts = parsed.processed_at || new Date(st.mtimeMs).toISOString();
    month = ts.slice(0, 7);
  } catch {
    month = new Date(st.mtimeMs).toISOString().slice(0, 7);
  }

  const archiveFile = join(archiveDir, `${month}.jsonl`);
  // One JSONL line per record; collapse the multi-line JSON object.
  const compact = JSON.stringify(JSON.parse(content));
  appendFileSync(archiveFile, compact + "\n", "utf8");
  unlinkSync(fp);
  archived++;
}
console.log(`archive-consumed: archived=${archived} skipped=${skipped} (cutoff=${ageDays}d)`);
'
