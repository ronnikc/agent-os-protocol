#!/usr/bin/env node
// split-engineering-lessons.mjs — one-shot Sprint 46.6.4 migration tool.
//
// Splits agent-os/memories/engineering-lessons-learned.md into focused per-section
// files so no single file exceeds 15 KB. Preserves every row verbatim. The
// original becomes a TOC pointer.
//
// Strategy:
//   - Detect the structural breaks in the file (table header line, "## "
//     section starts).
//   - Extract the front matter + Decision/Lesson table header.
//   - Bucket the data rows by month (cheap deterministic split that keeps
//     related lessons near each other).
//   - Write one file per bucket; emit the rules/constraints + sprint narrative
//     sections to their own files.
//   - Replace the original with a TOC stub.
//
// Usage:  node agent-os/scripts/split-engineering-lessons.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const PATH = 'agent-os/memories/engineering-lessons-learned.md';
const text = readFileSync(PATH, 'utf8');
const lines = text.split('\n');

// ── Locate structural sections by H2 anchor ──────────────────────────
const sectionStart = (name) => lines.findIndex(l => l.trim() === name);
const idxContext       = sectionStart('## Context');
const idxDecisionTable = sectionStart('## Decision / Lesson');
const idxRules         = sectionStart('## Rules / Constraints');
const idxSprint386     = sectionStart('## Sprint 38.6.0 (2026-04-04) — E2E Framework Remediation');
const idxSprint37238   = sectionStart('## Sprint Series 37.2.0–38.4.0 (2026-04-03/04) — Marathon Close-out Failure');
const idxSprint41      = sectionStart('## Sprint 41.0.0 / 41.1.0 — Shared platform pays for itself by epic 3 (2026-04-10)');
const idxRelated       = sectionStart('## Related memories');

if ([idxContext, idxDecisionTable, idxRules, idxSprint386, idxSprint37238, idxSprint41, idxRelated].some(i => i < 0)) {
  console.error('split-engineering-lessons: a required H2 section was not found');
  process.exit(2);
}

const frontMatter = lines.slice(0, idxContext + 1).join('\n');
const contextBody = lines.slice(idxContext + 1, idxDecisionTable).join('\n').trim();

// ── The Decision/Lesson big table ────────────────────────────────────
const decTableLines = lines.slice(idxDecisionTable, idxRules);
// Header lines (first 4 lines): "## Decision / Lesson", blank, "| Date | ..." header, "|------|..." separator
const decHeader = decTableLines.slice(0, 4);
const decRows   = decTableLines.slice(4).filter(l => l.trim().length > 0); // drop blank padding lines
const tableHeader = decHeader.slice(2).join('\n'); // "| Date | Lesson | Fix |\n|------|..."

// Bucket rows by month-of-date in the first column.
const buckets = new Map();
for (const row of decRows) {
  const m = row.match(/^\|\s*(\d{4}-\d{2})-/);
  const key = m ? m[1] : 'undated';
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(row);
}

// Months in chronological order
const months = Array.from(buckets.keys()).sort();
console.log('Month buckets:', months.map(m => `${m}=${buckets.get(m).length}`).join(' '));

// Some months are too big — split any bucket that would exceed 12 KB into
// halves until each is under the cap.
const SOFT_CAP = 12 * 1024;

function rowSize(row) { return Buffer.byteLength(row, 'utf8') + 1; }
function bucketSize(rows) { return rows.reduce((s, r) => s + rowSize(r), 0); }
function chunkBucket(rows) {
  const chunks = [];
  let current = [];
  let currentBytes = 0;
  for (const row of rows) {
    const sz = rowSize(row);
    if (currentBytes + sz > SOFT_CAP && current.length) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(row);
    currentBytes += sz;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const monthFiles = [];
for (const month of months) {
  const rows = buckets.get(month);
  const chunks = chunkBucket(rows);
  chunks.forEach((chunk, i) => {
    const suffix = chunks.length > 1 ? `-part${i + 1}` : '';
    const slug = `engineering-lessons-${month}${suffix}.md`;
    const path = `agent-os/memories/${slug}`;
    const body = [
      `Title: Engineering Lessons — ${month}${chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : ''}`,
      `Keywords: lessons, mistakes, ${month}`,
      `Scope: engineering`,
      `Last updated: 2026-04-27 (split from engineering-lessons-learned.md by Sprint 46.6.4)`,
      ``,
      `## Decision / Lesson — ${month}`,
      ``,
      tableHeader,
      ...chunk,
      ``,
    ].join('\n');
    writeFileSync(path, body, 'utf8');
    monthFiles.push({ slug, rows: chunk.length, bytes: Buffer.byteLength(body, 'utf8') });
  });
}

// ── Rules / Constraints — strip out embedded dated rows so the file stays
// under the L2 size cap; route the dated rows into the month buckets that
// already exist (or append to a Q2 spillover file if they don't fit).
const rulesRaw = lines.slice(idxRules, idxSprint386);
const ruleStructural = [];
const ruleDatedRows = [];
for (const ln of rulesRaw) {
  // Any line that starts a dated table row is treated as a lesson regardless
  // of whether it sits under a Date|Lesson|Fix header (the header was hoisted
  // to the top of the file at original authoring time).
  if (ln.match(/^\|\s*\d{4}-\d{2}-\d{2}/)) {
    ruleDatedRows.push(ln);
    continue;
  }
  // Skip pipe-only separator rows like "|---|---|---|"
  if (ln.match(/^\|[-\s|]+\|$/)) continue;
  ruleStructural.push(ln);
}
// Route dated rows into the existing month buckets so they ship in the
// per-month files alongside the others.
for (const row of ruleDatedRows) {
  const m = row.match(/^\|\s*(\d{4}-\d{2})-/);
  const key = m ? m[1] : 'undated';
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(row);
}

// Re-emit the per-month files (now with the rules table rows folded in).
monthFiles.length = 0;
for (const month of Array.from(buckets.keys()).sort()) {
  const rows = buckets.get(month);
  const chunks = chunkBucket(rows);
  chunks.forEach((chunk, i) => {
    const suffix = chunks.length > 1 ? `-part${i + 1}` : '';
    const slug = `engineering-lessons-${month}${suffix}.md`;
    const path = `agent-os/memories/${slug}`;
    const body = [
      `Title: Engineering Lessons — ${month}${chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : ''}`,
      `Keywords: lessons, mistakes, ${month}`,
      `Scope: engineering`,
      `Last updated: 2026-04-27 (split from engineering-lessons-learned.md by Sprint 46.6.4)`,
      ``,
      `## Decision / Lesson — ${month}`,
      ``,
      tableHeader,
      ...chunk,
      ``,
    ].join('\n');
    writeFileSync(path, body, 'utf8');
    monthFiles.push({ slug, rows: chunk.length, bytes: Buffer.byteLength(body, 'utf8') });
  });
}

writeFileSync('agent-os/memories/engineering-lessons-rules.md', [
  `Title: Engineering Lessons — Rules & Constraint Subsections`,
  `Keywords: lessons, rules, constraints, sprint-discipline`,
  `Scope: engineering`,
  `Last updated: 2026-04-27 (split from engineering-lessons-learned.md by Sprint 46.6.4)`,
  ``,
  ruleStructural.join('\n').trim(),
  ``,
].join('\n'), 'utf8');

// ── Sprint narratives (38.6.0, 37.2-38.4, 41.0/41.1) ─────────────────
const narrativesSection = lines.slice(idxSprint386, idxRelated).join('\n').trim();
writeFileSync('agent-os/memories/engineering-lessons-sprint-narratives.md', [
  `Title: Engineering Lessons — Sprint Narratives`,
  `Keywords: lessons, sprint-narratives, marathon, e2e, shared-platform`,
  `Scope: engineering`,
  `Last updated: 2026-04-27 (split from engineering-lessons-learned.md by Sprint 46.6.4)`,
  ``,
  narrativesSection,
  ``,
].join('\n'), 'utf8');

// ── Replace original with a TOC stub ─────────────────────────────────
const tocLines = [
  frontMatter.replace(/Last updated: .+/, 'Last updated: 2026-04-27 (split into per-month files by Sprint 46.6.4)'),
  ``,
  contextBody,
  ``,
  `> **Sprint 46.6.4 split:** This file used to be a single ~94 KB lessons table. To honor the Memory v2 layered-load contract (no single L2 file should exceed ~15 KB), the table was split into per-month files preserving every row verbatim. Use \`agent-os/memories/INDEX.aaak\` for topic discovery rather than scanning the originals — every row is now an INDEX entry.`,
  ``,
  `## Index`,
  ``,
  ...monthFiles.map(f => `- [${f.slug}](${f.slug}) — ${f.rows} lessons, ${(f.bytes / 1024).toFixed(1)} KB`),
  `- [engineering-lessons-rules.md](engineering-lessons-rules.md) — rules & constraint subsections`,
  `- [engineering-lessons-sprint-narratives.md](engineering-lessons-sprint-narratives.md) — narrative retrospectives (Sprints 38.6.0, 37.2-38.4, 41.0/41.1)`,
  ``,
  `## Related memories`,
  lines.slice(idxRelated + 1).join('\n').trim(),
  ``,
].join('\n');

writeFileSync(PATH, tocLines, 'utf8');

// ── Summary ──────────────────────────────────────────────────────────
console.log('Wrote:');
for (const f of monthFiles) {
  console.log(`  ${f.slug.padEnd(50)} ${f.rows.toString().padStart(3)} rows  ${(f.bytes / 1024).toFixed(1)} KB`);
}
console.log(`  engineering-lessons-rules.md`);
console.log(`  engineering-lessons-sprint-narratives.md`);
console.log(`Original engineering-lessons-learned.md replaced with TOC stub.`);
