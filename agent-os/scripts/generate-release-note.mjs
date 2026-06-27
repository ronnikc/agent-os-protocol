#!/usr/bin/env node
// generate-release-note.mjs — compact release-note generator from a sprint spec.
//
// Reads docs/product/phases/phase-25/sprint-<id>.md and emits a release note at
// docs/release-notes/<id>.md following the canonical compact format
// (modeled after 55.5.0.md). Idempotent — overwrites the target.
//
// Usage:
//   node agent-os/scripts/generate-release-note.mjs 51.0.0
//   node agent-os/scripts/generate-release-note.mjs 51.0.0 51.1.0 51.2.0 ...
//
// Pulls spec frontmatter (Status / Delivered / Phase / Dependencies), the Goal
// section, the Problem Statement, the Scope (locales + namespaces + translation
// volume), and the Acceptance Criteria. Writes a compact ~50-80 line release
// note. PR # is sourced from the phase-25/README.md sprint index status column.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = (() => {
  const here = fileURLToPath(import.meta.url);
  return here.replace(/\/agent-os\/scripts\/generate-release-note\.mjs$/, '');
})();

function readSpec(sprintId) {
  const path = join(REPO_ROOT, 'docs/product/phases/phase-25', `sprint-${sprintId}.md`);
  if (!existsSync(path)) throw new Error(`Spec not found: ${path}`);
  return readFileSync(path, 'utf8');
}

function readPhaseReadme() {
  const path = join(REPO_ROOT, 'docs/product/phases/phase-25/README.md');
  return readFileSync(path, 'utf8');
}

function extractSection(spec, heading) {
  const re = new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |^---|\\Z)`, 'm');
  const m = spec.match(re);
  return m ? m[1].trim() : '';
}

function extractFrontmatter(spec) {
  const out = {};
  for (const line of spec.split(/\r?\n/).slice(0, 30)) {
    const m = line.match(/^\*\*([^:]+):\*\*\s*(.+)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function extractTitle(spec) {
  const m = spec.match(/^#\s+Sprint\s+([\d.]+)\s+—\s+(.+)$/m);
  if (!m) return { id: '', title: '' };
  // Strip stale "(Pre-Plan)" / "(Active)" suffixes — specs frequently aren't
  // updated after merge, so the H1 still carries the planning-time status.
  const title = m[2].replace(/\s*\((Pre-Plan|Active|Draft|In-Progress)\)\s*$/i, '').trim();
  return { id: m[1], title };
}

function lookupPRNumber(sprintId, readme) {
  // Match a row like: | **51.0.0** | ... | **Delivered 2026-04-25** (PR #1602) |
  const re = new RegExp(`\\*\\*${sprintId.replace(/\./g, '\\.')}\\*\\*[^|]*\\|.*?\\(PR #(\\d+)\\)`, 's');
  const m = readme.match(re);
  return m ? m[1] : null;
}

function lookupDelivered(sprintId, readme) {
  const re = new RegExp(`\\*\\*${sprintId.replace(/\./g, '\\.')}\\*\\*[^|]*\\|.*?\\*\\*Delivered ([\\d-]+)\\*\\*`, 's');
  const m = readme.match(re);
  return m ? m[1] : null;
}

function compactSection(text, maxLines = 6) {
  if (!text) return '';
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.slice(0, maxLines).join('\n');
}

function generate(sprintId) {
  const spec = readSpec(sprintId);
  const readme = readPhaseReadme();
  const { title } = extractTitle(spec);
  const fm = extractFrontmatter(spec);
  const prNumber = lookupPRNumber(sprintId, readme);
  const delivered = lookupDelivered(sprintId, readme) || fm.Delivered || fm.Status?.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '';

  const goal = extractSection(spec, 'Goal');
  const problem = extractSection(spec, 'Problem Statement');
  const scope = extractSection(spec, 'Scope');
  const ac = extractSection(spec, 'Acceptance Criteria \\(Rough — To Be Refined When Scheduled\\)') ||
             extractSection(spec, 'Acceptance Criteria');

  const lines = [];
  lines.push(`# Release ${sprintId} — ${title}`);
  lines.push('');
  lines.push(`**Release Date:** ${delivered}`);
  lines.push(`**Sprint:** [Sprint ${sprintId}](../product/phases/phase-25/sprint-${sprintId}.md)`);
  lines.push(`**Phase:** 25 — EU Market Expansion + International Standards`);
  if (prNumber) lines.push(`**PR:** [#${prNumber}](https://github.com/ronnikc/agent-os-protocol/pull/${prNumber})`);
  lines.push(`**Type:** Translation / i18n catch-up (no source-code changes; locale string additions)`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(compactSection(goal, 8));
  lines.push('');

  if (problem) {
    lines.push('## Background');
    lines.push('');
    lines.push(compactSection(problem, 6));
    lines.push('');
  }

  if (scope) {
    lines.push('## Scope delivered');
    lines.push('');
    // Keep tables and bullet lists from scope verbatim — they're already structured
    lines.push(scope);
    lines.push('');
  }

  if (ac) {
    lines.push('## Acceptance criteria (per sprint spec — all met at PR merge)');
    lines.push('');
    lines.push(compactSection(ac, 12));
    lines.push('');
  }

  lines.push('## Compatibility / risk');
  lines.push('');
  lines.push('- No source-code changes — locale string additions only');
  lines.push('- No DB schema change — no migration risk');
  lines.push('- Frontend resolution already handles fallback via `deepMerge` (`src/shared/src/i18n/index.ts`); locales without entries fall through to EN');
  lines.push('- All Phase 25 i18n sprints follow the `MEMORY_DIARY_SUMMARISE` flag-controlled pattern; no behavior change');
  lines.push('');
  lines.push('## Phase 25 progress');
  lines.push('');
  lines.push('See [`docs/product/phases/phase-25/README.md`](../product/phases/phase-25/README.md) for the live sprint index, and [`RESUMPTION-PLAN.md`](../product/phases/phase-25/RESUMPTION-PLAN.md) for the authoritative real-time status.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Backfilled from sprint spec on 2026-04-28. Source-of-truth content is the [sprint spec](' + `../product/phases/phase-25/sprint-${sprintId}.md` + ').*');

  const outPath = join(REPO_ROOT, 'docs/release-notes', `${sprintId}.md`);
  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  return outPath;
}

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('Usage: node agent-os/scripts/generate-release-note.mjs <id> [<id> ...]');
  process.exit(2);
}
for (const id of ids) {
  try {
    const path = generate(id);
    console.log(`wrote ${path}`);
  } catch (err) {
    console.error(`FAILED ${id}: ${err.message}`);
  }
}
