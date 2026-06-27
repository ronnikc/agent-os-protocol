#!/usr/bin/env node
// build-memory-index.mjs — generate agent-os/memories/INDEX.aaak.jsonl + INDEX.aaak
//
// Walks `agent-os/memories/**/*.md` and `agent-os/sub-agents/memories/**/*.md`,
// extracts every H2 (`## `) and H3 (`### `) header + first sentence following it,
// runs a candidate-entity regex (CamelCase, ALL_CAPS, R-NN, sprint X.Y.Z, dotted
// versions), and emits two files:
//
//   - INDEX.aaak.jsonl  (committed source; one JSON object per line)
//   - INDEX.aaak        (generated, gitignored; compressed `topic|entities|→ref` lines)
//
// Idempotent: re-run on unchanged inputs produces a byte-identical INDEX.aaak.
// Determinism comes from sorting (file asc, line asc) and Object.keys order at emit.
//
// Usage: node agent-os/scripts/build-memory-index.mjs
//        bash agent-os/scripts/build-memory-index.sh   (thin wrapper)

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep, posix } from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const SCAN_DIRS = [
  'agent-os/memories',
  'agent-os/sub-agents/memories',
];
// Sprint 46.6.2 — also walk per-agent lessons dirs
// (agent-os/sub-agents/<name>/lessons/<sprint-id>.md). Diaries themselves
// are excluded — they are L1 spawn-prompt content, not L2 reference.
const PER_AGENT_LESSONS_GLOB = 'agent-os/sub-agents';
const SKIP_AGENT_DIRS = new Set(['memories', 'agents', 'skills']);
const OUT_JSONL = 'agent-os/memories/INDEX.aaak.jsonl';
const OUT_AAAK = 'agent-os/memories/INDEX.aaak';
const SKIP_FILES = new Set(['README.md', 'INDEX.aaak', 'INDEX.aaak.jsonl']);
const MAX_ENTITIES_PER_RECORD = 8;

// ── Walk a directory recursively for .md files ─────────────────────────
function walkMd(dir) {
  const out = [];
  const abs = join(REPO_ROOT, dir);
  let entries;
  try { entries = readdirSync(abs); } catch { return out; }
  for (const name of entries.sort()) {
    const p = join(abs, name);
    const rel = posix.join(...relative(REPO_ROOT, p).split(sep));
    const st = statSync(p);
    if (st.isDirectory()) { out.push(...walkMd(rel)); continue; }
    if (!name.endsWith('.md')) continue;
    if (SKIP_FILES.has(name)) continue;
    out.push(rel);
  }
  return out;
}

// ── Walk per-agent lessons dirs (Sprint 46.6.2) ─────────────────────────
function walkPerAgentLessons() {
  const out = [];
  const abs = join(REPO_ROOT, PER_AGENT_LESSONS_GLOB);
  let entries;
  try { entries = readdirSync(abs); } catch { return out; }
  for (const agentName of entries.sort()) {
    if (SKIP_AGENT_DIRS.has(agentName)) continue;
    const lessonsDir = join(abs, agentName, 'lessons');
    let lessonEntries;
    try { lessonEntries = readdirSync(lessonsDir); } catch { continue; }
    for (const lf of lessonEntries.sort()) {
      if (!lf.endsWith('.md')) continue;
      const rel = posix.join(PER_AGENT_LESSONS_GLOB, agentName, 'lessons', lf);
      out.push(rel);
    }
  }
  return out;
}

// ── Walk per-agent diaries (Sprint 46.6.9) ──────────────────────────────
// Skip placeholder diaries — they carry no signal. INDEX entries get scope
// `sub-agent:<name>:diary` to differentiate from `sub-agent:<name>` lessons.
const PLACEHOLDER_MARKER = '<!-- diary will be appended by post-sprint-memory.sh -->';
function walkPerAgentDiaries() {
  const out = [];
  const abs = join(REPO_ROOT, PER_AGENT_LESSONS_GLOB);
  let entries;
  try { entries = readdirSync(abs); } catch { return out; }
  for (const agentName of entries.sort()) {
    if (SKIP_AGENT_DIRS.has(agentName)) continue;
    const diary = join(abs, agentName, 'diary.md');
    let body;
    try { body = readFileSync(diary, 'utf8'); } catch { continue; }
    if (body.includes(PLACEHOLDER_MARKER)) continue;
    const rel = posix.join(PER_AGENT_LESSONS_GLOB, agentName, 'diary.md');
    out.push(rel);
  }
  return out;
}

// ── GitHub-style header slug ────────────────────────────────────────────
function slugify(s) {
  return s.toLowerCase()
    .replace(/[`'"!@#$%^&*()+=[\]{};:,.<>?/\\|~]/g, '')
    .replace(/&/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Strip markdown emphasis/links from a header text ────────────────────
function cleanHeader(s) {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) → text
    .replace(/[`*_]/g, '')
    .trim();
}

// ── Extract a one-sentence summary (first paragraph after a header) ─────
function firstSentence(lines, startIdx) {
  for (let i = startIdx; i < lines.length; i++) {
    const ln = lines[i];
    // Stop at next header
    if (/^#{1,6}\s/.test(ln)) return '';
    const trimmed = ln.trim();
    if (!trimmed) continue;
    // Skip list/quote/table/code-fence markers
    if (/^[>|`]/.test(trimmed) || /^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) continue;
    // Take this line, truncate at first ". " or end
    const m = trimmed.match(/^(.+?[.!?])(\s|$)/);
    const out = (m ? m[1] : trimmed).slice(0, 240);
    return out
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[`*_]/g, '');
  }
  return '';
}

// ── Candidate entities: CamelCase, ALL_CAPS, R-NN, X.Y.Z, dotted versions ──
function extractEntities(...texts) {
  const text = texts.join(' ');
  const found = new Set();

  // R-NN style rule codes
  for (const m of text.matchAll(/\bR-\d+\b/g)) found.add(m[0]);

  // Sprint IDs and version-like dotted numerics (X.Y.Z, X.Y.Z.W)
  for (const m of text.matchAll(/\b\d+\.\d+(?:\.\d+){1,2}\b/g)) found.add(m[0]);

  // ALL_CAPS abbreviations (≥2 chars), excluding boundary words
  for (const m of text.matchAll(/\b[A-Z]{2,}(?:[A-Z0-9]+)?\b/g)) {
    const t = m[0];
    if (!/^(THE|AND|FOR|WITH|FROM|INTO|THAT|THIS|MUST|NEVER|ALWAYS|ONLY|EVERY|TODO|FIXME|XXX|HACK)$/.test(t)) {
      found.add(t);
    }
  }

  // Hyphenated identifiers: i18n, e2e-tests, sub-agent (incl. hyphenated tech terms)
  for (const m of text.matchAll(/\b(?:i18n|e2e|a11y|rbac|api|cli|ui|ux)\b/gi)) {
    found.add(m[0].toLowerCase());
  }

  // CamelCase / TitleCase tokens (≥2 chars, must contain at least one lowercase)
  for (const m of text.matchAll(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g)) {
    const t = m[0];
    if (t.length >= 4 && !/^(The|And|For|With|From|Into|That|This|Must|Never|Always|Only|Every|When|Where|What|Why|How|Note|See|Use|Used|Per|Via|Such|Each|Both|All|Any|Some|Many|Few|More|Less|Most|Best|Worst)$/.test(t)) {
      found.add(t);
    }
  }

  // Take first MAX_ENTITIES_PER_RECORD in insertion order (matchAll order = left-to-right)
  return Array.from(found).slice(0, MAX_ENTITIES_PER_RECORD);
}

// ── Last-modified date for every memory file in one git call ────────────
const TODAY = new Date().toISOString().slice(0, 10);
function buildLastModifiedMap(files) {
  // Single `git log --name-only` invocation rather than one-per-file: the per-file
  // call cost dominated the rebuild on Windows Git Bash and pushed past the 2s AC.
  const map = new Map();
  if (!files.length) return map;
  try {
    const out = execSync(
      `git log --format='__COMMIT__%cs' --name-only -- ${files.map(f => `"${f}"`).join(' ')}`,
      { encoding: 'utf8' }
    );
    let date = TODAY;
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith('__COMMIT__')) {
        date = line.slice('__COMMIT__'.length).trim() || TODAY;
      } else if (line && !map.has(line)) {
        map.set(line, date);
      }
    }
  } catch { /* fall back to TODAY for everything */ }
  for (const f of files) if (!map.has(f)) map.set(f, TODAY);
  return map;
}

// ── Process one file → array of records ─────────────────────────────────
function processFile(file, updated) {
  const records = [];
  const content = readFileSync(join(REPO_ROOT, file), 'utf8');
  const lines = content.split(/\r?\n/);
  let scope = 'global';
  if (file.startsWith('agent-os/sub-agents/memories/')) {
    scope = 'sub-agent:shared';
  } else if (file.startsWith('agent-os/sub-agents/') && file.includes('/lessons/')) {
    const m = file.match(/^agent-os\/sub-agents\/([^\/]+)\/lessons\//);
    if (m) scope = `sub-agent:${m[1]}`;
  } else if (file.startsWith('agent-os/sub-agents/') && file.endsWith('/diary.md')) {
    const m = file.match(/^agent-os\/sub-agents\/([^\/]+)\/diary\.md$/);
    if (m) scope = `sub-agent:${m[1]}:diary`;
  }

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    let level = 0;
    if (ln.startsWith('### ')) level = 3;
    else if (ln.startsWith('## ')) level = 2;
    if (!level) continue;

    const headerRaw = ln.slice(level + 1);
    const topic = cleanHeader(headerRaw);
    if (!topic) continue;
    const anchor = slugify(topic);
    const sentence = firstSentence(lines, i + 1);
    const entities = extractEntities(topic, sentence);

    records.push({
      topic,
      entities,
      ref: `${file}#${anchor}`,
      scope,
      updated,
    });
  }

  return records;
}

// ── Main ────────────────────────────────────────────────────────────────
const allFiles = [
  ...SCAN_DIRS.flatMap(walkMd),
  ...walkPerAgentLessons(),
  ...walkPerAgentDiaries(),
].sort();
const lastModifiedMap = buildLastModifiedMap(allFiles);
const allRecords = [];
for (const f of allFiles) {
  allRecords.push(...processFile(f, lastModifiedMap.get(f) || TODAY));
}

// Sort by ref for byte-determinism (within a file, headers retain document order
// because `processFile` walks top-to-bottom; cross-file order is by sorted file path).
allRecords.sort((a, b) => a.ref.localeCompare(b.ref));

// Emit JSONL (committed source)
const jsonlLines = allRecords.map(r => JSON.stringify({
  topic: r.topic,
  entities: r.entities,
  ref: r.ref,
  scope: r.scope,
  updated: r.updated,
}));
writeFileSync(OUT_JSONL, jsonlLines.join('\n') + '\n', 'utf8');

// Emit AAAK (compressed pointer index, generated)
// Compression strategy:
//   - Drop the `agent-os/memories/` and `agent-os/sub-agents/memories/` prefix
//     (the index lives inside agent-os/memories/, so refs are relative to that root)
//   - Drop entities column (kept in INDEX.aaak.jsonl for richer queries)
//   - Topic capped to 80 chars
const STRIP_PREFIXES = [
  'agent-os/memories/',
  'agent-os/sub-agents/memories/',
];
function shortRef(ref) {
  for (const p of STRIP_PREFIXES) {
    if (ref.startsWith(p)) {
      const tag = p === 'agent-os/sub-agents/memories/' ? 'sub:' : '';
      return tag + ref.slice(p.length);
    }
  }
  return ref;
}
const aaakLines = allRecords.map(r => {
  const topic = r.topic.length > 80 ? r.topic.slice(0, 77) + '...' : r.topic;
  return `${topic}|→${shortRef(r.ref)}`;
});
writeFileSync(OUT_AAAK, aaakLines.join('\n') + '\n', 'utf8');

// Stdout summary
const sizeAaak = Buffer.byteLength(aaakLines.join('\n') + '\n', 'utf8');
process.stdout.write(
  `INDEX rebuilt: ${allRecords.length} entries from ${allFiles.length} files; ` +
  `INDEX.aaak ${sizeAaak} bytes\n`
);
