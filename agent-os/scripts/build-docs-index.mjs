#!/usr/bin/env node
// build-docs-index.mjs — generate agent-os/memories/docs-index.aaak.jsonl
//
// Parallel of build-memory-index.mjs for reference content under docs/.
// INDEX.aaak.jsonl indexes institutional knowledge (decisions, lessons,
// playbooks). docs-index.aaak.jsonl indexes slow-changing overview docs so
// agents can locate the right module/persona/framework section without
// reading 80–100KB files top-to-bottom.
//
// Idempotent: re-run on unchanged inputs produces a byte-identical output.
// Determinism comes from sorting (file asc, header order within file).
//
// Usage: node agent-os/scripts/build-docs-index.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const OUT_JSONL = 'agent-os/memories/docs-index.aaak.jsonl';
const MAX_ENTITIES_PER_RECORD = 8;

// Allow-list of overview docs to index. Scope: stable, agent-relevant
// reference content. Sprint specs, release notes, and per-module deep-dives
// are intentionally excluded — too volatile and too detailed for L2 lookup.
const DOCS = [
  'docs/content/modules-overview.md',
  'docs/content/modules-overview.vi.md',
  'docs/content/module-reference.md',
  'docs/content/personas-and-use-cases-overview.md',
  'docs/content/vn-regulatory-frameworks.md',
  'docs/content/maturity-phase-module-feature-additions.md',
  'docs/content/sector-overlay-plans.md',
];

// Parsing primitives — kept identical to build-memory-index.mjs so the two
// indexes share entity-extraction and slug semantics. If a third index is
// ever added, factor these into agent-os/scripts/aaak-index-lib.mjs.

function slugify(s) {
  return s.toLowerCase()
    .replace(/[`'"!@#$%^&*()+=[\]{};:,.<>?/\\|~]/g, '')
    .replace(/&/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function cleanHeader(s) {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_]/g, '')
    .trim();
}

function firstSentence(lines, startIdx) {
  for (let i = startIdx; i < lines.length; i++) {
    const ln = lines[i];
    if (/^#{1,6}\s/.test(ln)) return '';
    const trimmed = ln.trim();
    if (!trimmed) continue;
    if (/^[>|`]/.test(trimmed) || /^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) continue;
    const m = trimmed.match(/^(.+?[.!?])(\s|$)/);
    const out = (m ? m[1] : trimmed).slice(0, 240);
    return out
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[`*_]/g, '');
  }
  return '';
}

function extractEntities(...texts) {
  const text = texts.join(' ');
  const found = new Set();
  for (const m of text.matchAll(/\bR-\d+\b/g)) found.add(m[0]);
  for (const m of text.matchAll(/\b\d+\.\d+(?:\.\d+){1,2}\b/g)) found.add(m[0]);
  for (const m of text.matchAll(/\b[A-Z]{2,}(?:[A-Z0-9]+)?\b/g)) {
    const t = m[0];
    if (!/^(THE|AND|FOR|WITH|FROM|INTO|THAT|THIS|MUST|NEVER|ALWAYS|ONLY|EVERY|TODO|FIXME|XXX|HACK)$/.test(t)) {
      found.add(t);
    }
  }
  for (const m of text.matchAll(/\b(?:i18n|e2e|a11y|rbac|api|cli|ui|ux)\b/gi)) {
    found.add(m[0].toLowerCase());
  }
  for (const m of text.matchAll(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g)) {
    const t = m[0];
    if (t.length >= 4 && !/^(The|And|For|With|From|Into|That|This|Must|Never|Always|Only|Every|When|Where|What|Why|How|Note|See|Use|Used|Per|Via|Such|Each|Both|All|Any|Some|Many|Few|More|Less|Most|Best|Worst)$/.test(t)) {
      found.add(t);
    }
  }
  return Array.from(found).slice(0, MAX_ENTITIES_PER_RECORD);
}

const TODAY = new Date().toISOString().slice(0, 10);
function buildLastModifiedMap(files) {
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
  } catch { /* fall back to TODAY */ }
  for (const f of files) if (!map.has(f)) map.set(f, TODAY);
  return map;
}

function processFile(file, updated) {
  const records = [];
  const content = readFileSync(join(REPO_ROOT, file), 'utf8');
  const lines = content.split(/\r?\n/);
  // Scope keyed off the docs/ subdirectory — `doc:content` for this allow-list,
  // future expansions (docs/security/, docs/compliance/) get their own scope.
  const m = file.match(/^docs\/([^\/]+)\//);
  const scope = m ? `doc:${m[1]}` : 'doc';

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

const lastModifiedMap = buildLastModifiedMap(DOCS);
const allRecords = [];
for (const f of DOCS) {
  allRecords.push(...processFile(f, lastModifiedMap.get(f) || TODAY));
}
allRecords.sort((a, b) => a.ref.localeCompare(b.ref));

const jsonlLines = allRecords.map(r => JSON.stringify({
  topic: r.topic,
  entities: r.entities,
  ref: r.ref,
  scope: r.scope,
  updated: r.updated,
}));
writeFileSync(OUT_JSONL, jsonlLines.join('\n') + '\n', 'utf8');

process.stdout.write(
  `docs-index rebuilt: ${allRecords.length} entries from ${DOCS.length} files\n`
);
