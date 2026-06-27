#!/usr/bin/env bash
# render-spawn-prompt.sh — render the Diary + Routed Diaries L1 block for
# spawning a sub-agent.
#
# Sprint 46.6.7 — Agent OS Memory v2: Diary Enhancements (Part A).
# Honors the 800-token L1 budget from Sprint 46.6.0 — current diary is
# never truncated to make room for peer diaries; oldest peer entries are
# truncated first.
#
# Usage:  bash agent-os/scripts/render-spawn-prompt.sh <agent-slug>

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: bash agent-os/scripts/render-spawn-prompt.sh <agent-slug>" >&2
  exit 2
fi

AGENT="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

AGENT="$AGENT" node --input-type=module -e '
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const AGENT = process.env.AGENT;
const PLACEHOLDER = "<!-- diary will be appended by post-sprint-memory.sh -->";
const TOKEN_BUDGET = 800;
const CHARS_PER_TOKEN = 4; // rough heuristic; same as Anthropic public guidance
const CHAR_BUDGET = TOKEN_BUDGET * CHARS_PER_TOKEN;

// ── Validate agent ────────────────────────────────────────────────
if (!/^[a-z][a-z0-9-]+$/.test(AGENT)) {
  console.error(`render-spawn-prompt: invalid agent slug "${AGENT}"`);
  process.exit(2);
}
const ownDiary = join(REPO, `agent-os/sub-agents/${AGENT}/diary.md`);
if (!existsSync(ownDiary)) {
  console.error(`render-spawn-prompt: ${ownDiary} not found`);
  process.exit(2);
}

// ── Parse routing yaml (no js-yaml dep — minimal hand-parser) ─────
function parseRouting() {
  const path = join(REPO, "agent-os/sub-agents/diary-routing.yaml");
  if (!existsSync(path)) return new Map();
  const map = new Map();
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([a-z][a-z0-9-]+)\s*:\s*(.+)$/);
    if (!m) continue;
    const [, key, valRaw] = m;
    const val = valRaw.trim();
    if (val === "\"*\"" || val === "*") {
      map.set(key, "*");
    } else if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1).trim();
      const peers = inner ? inner.split(",").map(s => s.trim()).filter(Boolean) : [];
      map.set(key, peers);
    }
  }
  return map;
}

const routing = parseRouting();

// ── Resolve peer list ─────────────────────────────────────────────
function listAllAgents() {
  const dir = join(REPO, "agent-os/sub-agents");
  const SKIP = new Set(["memories", "agents", "skills"]);
  return readdirSync(dir)
    .filter(name => !SKIP.has(name))
    .filter(name => existsSync(join(dir, name, "diary.md")))
    .sort();
}

function resolvePeers(agent) {
  const v = routing.get(agent);
  if (!v) return [];
  if (v === "*") return listAllAgents().filter(a => a !== agent);
  return v.filter(a => a !== agent);
}

// ── Read a diary, dropping placeholder content ─────────────────────
function readNonPlaceholder(agent) {
  const path = join(REPO, `agent-os/sub-agents/${agent}/diary.md`);
  if (!existsSync(path)) return "";
  const raw = readFileSync(path, "utf8");
  if (raw.includes(PLACEHOLDER)) return "";
  // Take head -100 lines, matching the SUB-AGENTS.md template comment.
  return raw.split("\n").slice(0, 100).join("\n").trim();
}

// ── Render ─────────────────────────────────────────────────────────
const own = readNonPlaceholder(AGENT);
const ownBlock = own
  ? `## Diary (your persistent recall)\n${own}\n`
  : "";

const peers = resolvePeers(AGENT);
const peerBlocks = [];
let usedChars = ownBlock.length;
const reservedForOwn = Math.min(ownBlock.length, Math.floor(CHAR_BUDGET * 0.6));
const peerBudget = Math.max(CHAR_BUDGET - reservedForOwn, 0);
let peerUsed = 0;

for (const peer of peers) {
  const body = readNonPlaceholder(peer);
  if (!body) continue;
  const block = `<!-- routed from: ${peer} -->\n${body}`;
  // Truncate from the END (oldest entries) — diaries are written newest-at-top
  // post-46.6.7B. With current placeholder corpus this is moot.
  const remaining = peerBudget - peerUsed;
  if (remaining <= 0) break;
  const trimmed = block.slice(0, remaining);
  peerBlocks.push(trimmed);
  peerUsed += trimmed.length + 2; // +2 for the join newlines
}

const routedBlock = peerBlocks.length
  ? `## Routed Diaries (cross-agent context — Sprint 46.6.7)\n${peerBlocks.join("\n\n")}\n`
  : "";

// ── Output ─────────────────────────────────────────────────────────
process.stdout.write(ownBlock + (ownBlock && routedBlock ? "\n" : "") + routedBlock);
'
