#!/usr/bin/env bash
# embeddings-rebuild.sh — rebuild the semantic-recall index.
#
# Sprint 46.6.6 — Semantic Recall (optional).
# Reads INDEX.aaak.jsonl + every per-agent diary.md, runs the active embedder
# (TF-IDF for MEMORY_SEMANTIC_RECALL=on; external API for byok), writes
# agent-os/embeddings.json (gitignored derived cache) and updates
# agent-os/embeddings.config.jsonl (committed model-version manifest).
#
# Idempotent — skips entries whose source-hash matches the stored hash.
#
# Usage:  bash agent-os/scripts/embeddings-rebuild.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

MODE="${MEMORY_SEMANTIC_RECALL:-off}"
case "$MODE" in
  off)
    echo "embeddings-rebuild: MEMORY_SEMANTIC_RECALL=off — nothing to do."
    exit 0
    ;;
  on|byok)
    ;;
  *)
    echo "embeddings-rebuild: unknown MEMORY_SEMANTIC_RECALL=$MODE (expected off|on|byok)" >&2
    exit 2
    ;;
esac

node --input-type=module -e '
import {
  loadCorpora, embedTfIdf, embedByok, getMode, getModelTag, EMBEDDINGS_PATH, CONFIG_PATH,
} from "./agent-os/scripts/embeddings-lib.mjs";
import { writeFileSync, existsSync, readFileSync, appendFileSync } from "node:fs";

const mode = getMode();
const modelTag = getModelTag();
const docs = loadCorpora();

let entries;
if (mode === "byok") {
  entries = [];
  for (const d of docs) {
    const embedding = await embedByok(d.text);
    if (!Array.isArray(embedding)) {
      console.error(`embeddings-rebuild: byok did not return a numeric array for ${d.corpus}/${d.doc_id}`);
      process.exit(3);
    }
    entries.push({
      corpus: d.corpus, doc_id: d.doc_id,
      kind: "dense", embedding, model: modelTag,
      source_hash: d.sourceHash, embedded_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    });
  }
} else {
  // Local TF-IDF — sparse vector representation
  const embedded = embedTfIdf(docs);
  entries = embedded.map(d => ({
    corpus: d.corpus, doc_id: d.doc_id,
    kind: "sparse-tfidf", vector: d.vector, norm: d.norm,
    model: modelTag,
    source_hash: d.sourceHash,
    embedded_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  }));
}

// Idempotency: dedup by (corpus, doc_id, source_hash, model). Re-running on
// unchanged corpus produces zero new entries.
const previous = (() => {
  if (!existsSync(EMBEDDINGS_PATH)) return [];
  try { return JSON.parse(readFileSync(EMBEDDINGS_PATH, "utf8")).entries || []; }
  catch { return []; }
})();
const prevKeys = new Set(previous.map(e => `${e.corpus}|${e.doc_id}|${e.source_hash}|${e.model}`));
const newKeys = new Set(entries.map(e => `${e.corpus}|${e.doc_id}|${e.source_hash}|${e.model}`));

let reusedFromCache = 0;
const merged = entries.map(e => {
  const k = `${e.corpus}|${e.doc_id}|${e.source_hash}|${e.model}`;
  if (prevKeys.has(k)) {
    reusedFromCache++;
    const prev = previous.find(p =>
      p.corpus === e.corpus && p.doc_id === e.doc_id &&
      p.source_hash === e.source_hash && p.model === e.model
    );
    return prev;
  }
  return e;
});

writeFileSync(EMBEDDINGS_PATH, JSON.stringify({
  generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  model: modelTag,
  entries: merged,
}, null, 2), "utf8");

// Append to the committed config manifest if the (corpus, model) pair is new.
const corporaSeen = new Set();
for (const e of entries) corporaSeen.add(`${e.corpus}|${e.model}`);
const configLines = existsSync(CONFIG_PATH)
  ? readFileSync(CONFIG_PATH, "utf8").split("\n").filter(l => l.trim())
  : [];
const known = new Set(configLines.map(l => {
  try { const p = JSON.parse(l); return `${p.corpus}|${p.model}`; } catch { return ""; }
}));
let configAdditions = 0;
for (const key of corporaSeen) {
  if (!known.has(key)) {
    const [corpus, model] = key.split("|");
    appendFileSync(CONFIG_PATH, JSON.stringify({
      corpus, model,
      first_seen_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    }) + "\n", "utf8");
    configAdditions++;
  }
}

const reembedded = entries.length - reusedFromCache;
console.log(`embeddings-rebuild: mode=${mode} model=${modelTag} ` +
            `total=${entries.length} reused=${reusedFromCache} re-embedded=${reembedded} ` +
            `config-additions=${configAdditions}`);
'
