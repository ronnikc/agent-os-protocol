// embeddings-lib.mjs — pluggable semantic-recall layer for the Agent OS Memory v2.
//
// Sprint 46.6.6 — Semantic Recall (optional, feature-flagged).
// Two modes selected by env var MEMORY_SEMANTIC_RECALL:
//   off  (default) — scripts are no-ops; literal INDEX scan unchanged
//   on             — local TF-IDF cosine similarity (zero-dep, deterministic)
//   byok           — POSTs to MEMORY_EMBEDDING_PROVIDER with MEMORY_EMBEDDING_API_KEY
//
// "Local" is TF-IDF rather than onnxruntime-node — see Sprint 46.6.6 spec
// AC-1 variance for rationale (zero new deps; the format stays
// forward-compatible so a future sprint can swap in real embeddings without
// changing any caller).

import { readFileSync, existsSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { join, posix, sep, relative } from 'node:path';
import { createHash } from 'node:crypto';

export const REPO_ROOT = process.cwd();
export const EMBEDDINGS_PATH = join(REPO_ROOT, 'agent-os/embeddings.json');
export const CONFIG_PATH = join(REPO_ROOT, 'agent-os/embeddings.config.jsonl');

export function getMode() {
  return (process.env.MEMORY_SEMANTIC_RECALL || 'off').toLowerCase();
}

export function getModelTag() {
  const mode = getMode();
  if (mode === 'byok') {
    const provider = process.env.MEMORY_EMBEDDING_PROVIDER || '';
    if (!provider) {
      throw new Error('MEMORY_SEMANTIC_RECALL=byok requires MEMORY_EMBEDDING_PROVIDER');
    }
    return `byok:${provider}`;
  }
  if (mode === 'on') return 'local:tfidf-v1';
  return 'off';
}

// ── Source corpora — INDEX entries + per-agent diaries ──────────────
export function loadCorpora() {
  const docs = [];

  // INDEX.aaak.jsonl
  const indexPath = join(REPO_ROOT, 'agent-os/memories/INDEX.aaak.jsonl');
  if (existsSync(indexPath)) {
    const lines = readFileSync(indexPath, 'utf8').split('\n').filter(l => l.trim());
    for (const ln of lines) {
      try {
        const e = JSON.parse(ln);
        const text = `${e.topic} ${(e.entities || []).join(' ')}`;
        docs.push({ corpus: 'index', doc_id: e.ref, text, sourceHash: hashText(text) });
      } catch { /* skip */ }
    }
  }

  // Per-agent diaries
  const subagentsDir = join(REPO_ROOT, 'agent-os/sub-agents');
  if (existsSync(subagentsDir)) {
    const SKIP = new Set(['memories', 'agents', 'skills']);
    for (const agentName of readdirSync(subagentsDir).sort()) {
      if (SKIP.has(agentName)) continue;
      const diaryPath = join(subagentsDir, agentName, 'diary.md');
      if (!existsSync(diaryPath)) continue;
      const text = readFileSync(diaryPath, 'utf8');
      // Skip placeholder diaries — they don't carry recall signal
      if (text.includes('<!-- diary will be appended by post-sprint-memory.sh -->')) continue;
      docs.push({ corpus: 'diaries', doc_id: agentName, text, sourceHash: hashText(text) });
    }
  }

  return docs;
}

function hashText(t) {
  return createHash('sha256').update(t).digest('hex').slice(0, 16);
}

// ── TF-IDF embedder (zero-dep, deterministic) ───────────────────────
// Tokenises lower-cased alpha-num runs; computes term frequency per doc;
// computes inverse document frequency across the corpus; returns sparse
// {term: weight} maps. Cosine similarity is dot(a,b) / (norm(a)*norm(b)).
function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

function tf(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

function idf(corpusTokens) {
  const df = new Map();
  for (const tokens of corpusTokens) {
    const seen = new Set(tokens);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = corpusTokens.length || 1;
  const out = new Map();
  for (const [t, count] of df) out.set(t, Math.log((N + 1) / (count + 1)) + 1);
  return out;
}

export function embedTfIdf(docs) {
  const corpusTokens = docs.map(d => tokenize(d.text));
  const idfMap = idf(corpusTokens);
  return docs.map((d, i) => {
    const tfMap = tf(corpusTokens[i]);
    const vec = {};
    let normSq = 0;
    for (const [term, freq] of tfMap) {
      const w = freq * (idfMap.get(term) || 0);
      vec[term] = w;
      normSq += w * w;
    }
    return {
      ...d,
      vector: vec,
      norm: Math.sqrt(normSq) || 1,
      idfRef: idfMap, // shared reference; not serialised — written separately
    };
  });
}

export function embedQueryTfIdf(query, idfMap) {
  const tokens = tokenize(query);
  const tfMap = tf(tokens);
  const vec = {};
  let normSq = 0;
  for (const [term, freq] of tfMap) {
    const w = freq * (idfMap.get(term) || 0);
    if (w > 0) {
      vec[term] = w;
      normSq += w * w;
    }
  }
  return { vector: vec, norm: Math.sqrt(normSq) || 1 };
}

export function cosine(a, b) {
  let dot = 0;
  const small = Object.keys(a.vector).length < Object.keys(b.vector).length ? a.vector : b.vector;
  const large = small === a.vector ? b.vector : a.vector;
  for (const term in small) {
    if (term in large) dot += a.vector[term] * b.vector[term];
  }
  return dot / (a.norm * b.norm);
}

// ── BYOK path — POSTs to a configured embedding API ─────────────────
//
// Contract: MEMORY_EMBEDDING_PROVIDER is a URL accepting POST {input: string}
// and returning JSON {embedding: number[]}. Compatible with OpenAI's
// /v1/embeddings shape after a `data[0].embedding` projection.
export async function embedByok(text) {
  const provider = process.env.MEMORY_EMBEDDING_PROVIDER;
  const apiKey = process.env.MEMORY_EMBEDDING_API_KEY;
  if (!provider || !apiKey) {
    throw new Error('MEMORY_SEMANTIC_RECALL=byok requires MEMORY_EMBEDDING_PROVIDER and MEMORY_EMBEDDING_API_KEY (no silent fallback).');
  }
  const res = await fetch(provider, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: text }),
  });
  if (!res.ok) {
    throw new Error(`BYOK embed failed: ${res.status} ${res.statusText}`);
  }
  const j = await res.json();
  return j?.data?.[0]?.embedding ?? j?.embedding ?? null;
}

export function denseDotCosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
