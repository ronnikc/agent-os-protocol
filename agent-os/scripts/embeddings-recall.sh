#!/usr/bin/env bash
# embeddings-recall.sh — query the semantic-recall index.
#
# Sprint 46.6.6 — Semantic Recall (optional).
#
# Usage:
#   bash agent-os/scripts/embeddings-recall.sh "<query>"
#   bash agent-os/scripts/embeddings-recall.sh "<query>" --corpus index|diaries
#   bash agent-os/scripts/embeddings-recall.sh "<query>" --top 10
#
# Returns top-N matches with similarity score across both corpora unless
# --corpus is specified. Fails fast when MEMORY_SEMANTIC_RECALL=off (no
# silent fallback).

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: bash agent-os/scripts/embeddings-recall.sh \"<query>\" [--corpus <name>] [--top <N>]" >&2
  exit 2
fi

QUERY="$1"; shift
CORPUS=""
TOP="5"

while [ $# -gt 0 ]; do
  case "$1" in
    --corpus) CORPUS="$2"; shift 2 ;;
    --top)    TOP="$2"; shift 2 ;;
    *) echo "embeddings-recall: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

MODE="${MEMORY_SEMANTIC_RECALL:-off}"
if [ "$MODE" = "off" ]; then
  echo "embeddings-recall: MEMORY_SEMANTIC_RECALL=off — semantic recall is disabled. Set MEMORY_SEMANTIC_RECALL=on for local TF-IDF or =byok for an external API." >&2
  exit 1
fi

QUERY="$QUERY" CORPUS="$CORPUS" TOP="$TOP" \
  node --input-type=module -e '
import {
  embedTfIdf, embedQueryTfIdf, embedByok, denseDotCosine, cosine,
  loadCorpora, getMode, getModelTag, EMBEDDINGS_PATH,
} from "./agent-os/scripts/embeddings-lib.mjs";
import { existsSync, readFileSync } from "node:fs";

if (!existsSync(EMBEDDINGS_PATH)) {
  console.error("embeddings-recall: embeddings.json missing — run embeddings-rebuild.sh first.");
  process.exit(2);
}

const mode = getMode();
const modelTag = getModelTag();
const cache = JSON.parse(readFileSync(EMBEDDINGS_PATH, "utf8"));
if (cache.model !== modelTag) {
  console.error(`embeddings-recall: cache model (${cache.model}) does not match active model (${modelTag}) — run embeddings-rebuild.sh.`);
  process.exit(2);
}

const corpus = process.env.CORPUS || "";
const top = parseInt(process.env.TOP || "5", 10) || 5;
const query = process.env.QUERY || "";

let entries = cache.entries;
if (corpus) entries = entries.filter(e => e.corpus === corpus);

let results = [];
if (mode === "byok") {
  const qEmb = await embedByok(query);
  if (!Array.isArray(qEmb)) {
    console.error("embeddings-recall: byok did not return a vector for the query.");
    process.exit(3);
  }
  for (const e of entries) {
    if (e.kind !== "dense") continue;
    results.push({ ...e, score: denseDotCosine(qEmb, e.embedding) });
  }
} else {
  // Local TF-IDF — recompute idf from the live corpus to embed the query
  // (cheap; ~60 docs).
  const docs = loadCorpora();
  const embedded = embedTfIdf(docs);
  const idfMap = embedded[0]?.idfRef || new Map();
  const q = embedQueryTfIdf(query, idfMap);
  for (const e of entries) {
    if (e.kind !== "sparse-tfidf") continue;
    results.push({ ...e, score: cosine(q, { vector: e.vector, norm: e.norm }) });
  }
}

results.sort((a, b) => b.score - a.score);
const top_results = results.slice(0, top);
for (const r of top_results) {
  console.log(`${r.score.toFixed(3)}  [${r.corpus}]  ${r.doc_id}`);
}
console.error(`(${top_results.length} of ${entries.length} ${corpus ? "in " + corpus : "across both corpora"}, model=${modelTag})`);
'
