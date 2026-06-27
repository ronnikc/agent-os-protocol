#!/usr/bin/env node
// process-spawn-requests.mjs — orchestrator pickup for the Memory v2 write path.
//
// Sprint 46.6.8 — closes the load-bearing 46.6.2 / 46.6.7 deferral by
// actually consuming .claude/spawn-requests/post-sprint-memory-*.json,
// writing per-agent diary entries, emitting sprint-completion facts, and
// rolling over diaries that exceed the 200-line cap.
//
// Deterministic by default (no LLM) — derives diary content from
// `git log` + `git diff --name-only` + a static file→agent map. A future
// orchestrator (boss-agent) can swap the baseline for an LLM-bound
// documentation sub-agent without changing the processor's interface.
//
// Usage:  node agent-os/scripts/process-spawn-requests.mjs [--once]
//   --once   process exactly one request and exit (used by the smoke test)

import {
  readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync,
  existsSync, statSync, renameSync, unlinkSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const QUEUE_DIR = join(REPO_ROOT, '.claude/spawn-requests');
const CONSUMED_DIR = join(QUEUE_DIR, 'consumed');
const LOG_DIR = join(REPO_ROOT, 'agent-os/logs/post-sprint-memory');
const DIARY_LINE_CAP = 200;
const KEEP_MOST_RECENT_ENTRIES = 5;

// ── File → agent mapping ────────────────────────────────────────────
//
// Pure function. Returns an array of agent slugs (may be empty for files
// that don't belong to any agent — e.g. node_modules diffs, lockfiles).
export function fileToAgents(path) {
  if (!path) return [];
  // Tests trump src/ ownership — failing tests are the test agent's problem
  if (path.match(/\.test\.tsx?$/) || path.includes('/__tests__/')) {
    if (path.startsWith('src/frontend/')) return ['test', 'frontend'];
    if (path.startsWith('src/backend/'))  return ['test', 'backend'];
    return ['test'];
  }
  if (path.startsWith('e2e/')) return ['test'];
  if (path.startsWith('src/backend/')) {
    if (path.includes('/auth') || path.includes('/security')) return ['backend', 'security'];
    if (path.includes('/i18n/') || path.includes('/localization/')) return ['backend', 'i18n'];
    return ['backend'];
  }
  if (path.startsWith('src/frontend/')) {
    if (path.includes('/i18n/')) return ['frontend', 'i18n'];
    if (path.includes('/accessibility') || path.includes('/a11y')) return ['frontend', 'accessibility'];
    return ['frontend'];
  }
  if (path.startsWith('src/shared/src/types/')) return ['backend', 'frontend'];
  if (path.startsWith('src/shared/')) return ['backend', 'frontend'];
  if (path.startsWith('docs/security/'))            return ['security'];
  if (path.startsWith('docs/compliance/'))          return ['compliance'];
  if (path.startsWith('docs/legal/'))               return ['legal'];
  if (path.startsWith('docs/accessibility/'))       return ['accessibility'];
  if (path.startsWith('docs/release-notes/'))       return ['release', 'documentation'];
  if (path.startsWith('docs/product/phases/'))      return ['planning', 'product'];
  if (path.startsWith('docs/user-guide/') ||
      path.startsWith('docs/help-center/'))         return ['help-center-content'];
  if (path.startsWith('docs/training/') ||
      path.startsWith('docs/content/'))             return ['content'];
  if (path.startsWith('docs/marketing/') ||
      path.startsWith('docs/seo/'))                 return ['content-marketing', 'seo'];
  if (path.startsWith('docs/infrastructure/'))      return ['infrastructure'];
  if (path.startsWith('docs/engineering/'))         return ['documentation', 'backend'];
  if (path.startsWith('docs/backend/'))             return ['backend', 'documentation'];
  if (path.startsWith('docs/frontend/'))            return ['frontend', 'documentation'];
  if (path.startsWith('docs/testing/'))             return ['test', 'documentation'];
  if (path.startsWith('docs/api/'))                 return ['api', 'documentation'];
  if (path.startsWith('agent-os/sub-agents/'))      return ['documentation'];
  if (path.startsWith('agent-os/scripts/'))         return ['documentation'];
  if (path === 'CLAUDE.md' ||
      path === 'agent-os/RULES.md' ||
      path === 'agent-os/SPRINTS.md' ||
      path === 'agent-os/SUB-AGENTS.md' ||
      path === 'agent-os/MEMORY.md' ||
      path === 'agent-os/STATE.md')                 return ['documentation', 'planning'];
  if (path.startsWith('agent-os/'))                 return ['documentation'];
  if (path === '.husky/pre-commit')                 return ['build-integrity'];
  if (path.startsWith('.github/workflows/'))        return ['release', 'build-integrity'];
  if (path.startsWith('docs/'))                     return ['documentation'];
  if (path.endsWith('.md'))                         return ['documentation'];
  return [];
}

// ── Helpers ──────────────────────────────────────────────────────────
function ts() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
function dayStr() { return new Date().toISOString().slice(0, 10); }

function logTo(logPath, line) {
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(logPath, `[${ts()}] ${line}\n`, 'utf8');
}

function gitLog(base, head) {
  try {
    return execSync(`git log --format=%s ${base}..${head}`, { encoding: 'utf8' }).trim();
  } catch { return ''; }
}

function gitDiffNames(base, head) {
  try {
    return execSync(`git diff --name-only ${base}..${head}`, { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch { return []; }
}

function gitDiffOf(base, head, path) {
  try {
    return execSync(`git diff ${base}..${head} -- "${path}"`, { encoding: 'utf8' });
  } catch { return ''; }
}

function resolveBase(branchName) {
  // Find merge-base with main; falls back to HEAD~10 then to empty tree.
  try {
    return execSync(`git merge-base main ${branchName} 2>/dev/null`, { encoding: 'utf8' }).trim();
  } catch {
    try {
      return execSync('git rev-parse HEAD~10', { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  }
}

// ── Diary entry writer (Sprint 46.6.9 — smarter deterministic synthesis) ────
//
// Groups commits by conventional-commit prefix, highlights test/CI/spec
// changes, surfaces phase transitions, and pushes the raw file list into a
// trailing details block so the diary stays readable. No LLM call.
function classifyCommit(subject) {
  const m = subject.match(/^(?<type>fix|feat|docs|refactor|chore|test|sprint|perf|style|ci|build|revert)(?:\([^)]*\))?\s*[:!]?\s*(?<rest>.+)$/i);
  if (m && m.groups) return { type: m.groups.type.toLowerCase(), summary: m.groups.rest.trim() };
  // Sprint-style "sprint 46.6.9: ..."
  const sprintMatch = subject.match(/^sprint\s+(\d+\.\d+(?:\.\d+){0,2})\s*[:.-]\s*(.+)$/i);
  if (sprintMatch) return { type: 'sprint', summary: sprintMatch[2] };
  return { type: 'other', summary: subject };
}

function classifyFile(path) {
  if (/\.test\.(t|j)sx?$/.test(path) || path.includes('/__tests__/')) return 'test';
  if (path.startsWith('e2e/')) return 'test-e2e';
  if (path.startsWith('docs/product/phases/')) return 'spec';
  if (path === 'agent-os/RULES.md' || path === 'agent-os/SPRINTS.md') return 'governance';
  if (path === 'agent-os/STATE.md') return 'state';
  if (path.startsWith('.github/workflows/')) return 'ci';
  if (path === '.husky/pre-commit' || path === '.husky/post-merge') return 'ci-hook';
  if (path.startsWith('docs/')) return 'docs';
  if (path.startsWith('src/shared/')) return 'shared-types';
  if (path.startsWith('src/backend/')) return 'backend-code';
  if (path.startsWith('src/frontend/')) return 'frontend-code';
  if (path.startsWith('agent-os/scripts/')) return 'tooling';
  return 'other';
}

function detectPhaseTransitions(diffOut) {
  // diffOut is `git diff <base>..<head> -- agent-os/STATE.md`. Look for
  // `Active` ↔ `Complete` ↔ `Pending` flips on phase rows.
  if (!diffOut) return [];
  const transitions = [];
  for (const line of diffOut.split('\n')) {
    if (!line.startsWith('+|') && !line.startsWith('-|')) continue;
    const m = line.match(/^[+-]\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (!m) continue;
    const sign = line[0];
    transitions.push({ sign, phase: m[1], title: m[2].trim(), status: m[4].trim() });
  }
  // Pair add/remove on the same phase
  const byPhase = new Map();
  for (const t of transitions) {
    if (!byPhase.has(t.phase)) byPhase.set(t.phase, { phase: t.phase });
    const acc = byPhase.get(t.phase);
    if (t.sign === '-') acc.from = t.status;
    if (t.sign === '+') { acc.to = t.status; acc.title = t.title; }
  }
  return Array.from(byPhase.values()).filter(t => t.from && t.to && t.from !== t.to);
}

function buildDiaryEntry(sprint, commitSubjects, agentFiles, options = {}) {
  const today = dayStr();
  const headerToken = `## ${today} — Sprint ${sprint}`;
  const sections = [];

  // ── Commit summary by type ───────────────────────────────────────
  if (commitSubjects.length) {
    const byType = new Map();
    for (const subj of commitSubjects) {
      const { type, summary } = classifyCommit(subj);
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(summary);
    }
    const TYPE_ORDER = ['sprint', 'feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'ci', 'build', 'chore', 'style', 'revert', 'other'];
    const lines = [];
    for (const t of TYPE_ORDER) {
      const items = byType.get(t);
      if (!items?.length) continue;
      const top = items[0];
      const more = items.length > 1 ? ` (+${items.length - 1})` : '';
      lines.push(`- **${t}** — ${top}${more}`);
    }
    if (lines.length) sections.push(`**Commits (${commitSubjects.length}):**\n${lines.join('\n')}`);
  }

  // ── File-class highlights ────────────────────────────────────────
  if (agentFiles.length) {
    const byClass = new Map();
    for (const f of agentFiles) {
      const c = classifyFile(f);
      byClass.set(c, (byClass.get(c) || 0) + 1);
    }
    const highlights = [];
    if (byClass.get('test'))         highlights.push(`${byClass.get('test')} unit/integration test file(s)`);
    if (byClass.get('test-e2e'))     highlights.push(`${byClass.get('test-e2e')} e2e file(s)`);
    if (byClass.get('spec'))         highlights.push(`${byClass.get('spec')} sprint spec file(s)`);
    if (byClass.get('governance'))   highlights.push('governance rules updated');
    if (byClass.get('state'))        highlights.push('STATE.md updated');
    if (byClass.get('ci') || byClass.get('ci-hook')) highlights.push('CI/hook changes');
    if (byClass.get('shared-types')) highlights.push(`${byClass.get('shared-types')} shared-type file(s)`);
    if (byClass.get('backend-code')) highlights.push(`${byClass.get('backend-code')} backend file(s)`);
    if (byClass.get('frontend-code'))highlights.push(`${byClass.get('frontend-code')} frontend file(s)`);
    if (byClass.get('docs'))         highlights.push(`${byClass.get('docs')} docs file(s)`);
    if (byClass.get('tooling'))      highlights.push(`${byClass.get('tooling')} tooling change(s)`);
    if (highlights.length) sections.push(`**Highlights:** ${highlights.join('; ')}.`);
  }

  // ── Phase transitions (from STATE.md diff if available) ──────────
  const transitions = options.phaseTransitions || [];
  if (transitions.length) {
    const lines = transitions.map(t =>
      `- Phase ${t.phase} (${t.title}): ${t.from} → ${t.to}`
    );
    sections.push(`**Phase transitions:**\n${lines.join('\n')}`);
  }

  // ── Trailing file list (compact; full list lives in git) ─────────
  if (agentFiles.length) {
    const sample = agentFiles.slice(0, 5).map(f => `\`${f}\``).join(', ');
    const more = agentFiles.length > 5 ? ` (+${agentFiles.length - 5} more)` : '';
    sections.push(`<details><summary>Files (${agentFiles.length})</summary>\n\n${sample}${more}\n\n</details>`);
  }

  return `${headerToken}\n\n${sections.join('\n\n')}\n`;
}

function appendDiaryEntry(agent, sprint, commitSubjects, agentFiles, log, options = {}) {
  const diaryPath = join(REPO_ROOT, `agent-os/sub-agents/${agent}/diary.md`);
  if (!existsSync(diaryPath)) {
    logTo(log, `appendDiaryEntry skip: ${diaryPath} not found`);
    return false;
  }
  let content = readFileSync(diaryPath, 'utf8');

  const entryHeader = `## ${dayStr()} — Sprint ${sprint}`;
  if (content.includes(entryHeader)) {
    logTo(log, `appendDiaryEntry skip dup: ${agent} already has '${entryHeader}'`);
    return false;
  }

  const newEntry = buildDiaryEntry(sprint, commitSubjects, agentFiles, options);

  // Drop the placeholder marker on first real write — keep the file's H1
  // intro paragraph above the entries.
  const placeholderMarker = '<!-- diary will be appended by post-sprint-memory.sh -->';
  if (content.includes(placeholderMarker)) {
    content = content.replace(placeholderMarker, '').trimEnd() + '\n';
  }

  // Newest-on-top so spawn-prompt `head -100` picks recent entries first.
  // Insert entries below the H1 + intro paragraph (which ends at the first
  // blank line after the H1).
  const lines = content.split('\n');
  const h1Idx = lines.findIndex(l => l.startsWith('# '));
  let insertIdx = lines.length;
  if (h1Idx >= 0) {
    // Insertion point is the line after the H1 + intro block. The intro
    // is "blank lines + blockquote lines + blank lines" right under the
    // H1; entries land newest-first AFTER the intro.
    let i = h1Idx + 1;
    while (i < lines.length && lines[i].trim() === '') i++;
    while (i < lines.length && lines[i].startsWith('>')) i++;
    while (i < lines.length && lines[i].trim() === '') i++;
    insertIdx = i;
  }
  const before = lines.slice(0, insertIdx).join('\n').trimEnd();
  const after  = lines.slice(insertIdx).join('\n').trimStart();
  const next = `${before}\n\n${newEntry}\n${after}`.replace(/\n{3,}/g, '\n\n');

  writeFileSync(diaryPath, next, 'utf8');
  logTo(log, `appendDiaryEntry: ${agent} <- ${entryHeader} (${agentFiles.length} files)`);
  return true;
}

// ── Diary rollover ───────────────────────────────────────────────────
function rolloverDiary(agent, sprint, log) {
  const diaryPath = join(REPO_ROOT, `agent-os/sub-agents/${agent}/diary.md`);
  if (!existsSync(diaryPath)) return false;
  const content = readFileSync(diaryPath, 'utf8');
  const lineCount = content.split('\n').length;
  if (lineCount <= DIARY_LINE_CAP) return false;

  // Parse entries: split on `## ` H2 boundaries so each entry is intact.
  const lines = content.split('\n');

  // Header block: H1 + any `>` blockquote lines + any pre-existing
  // `## Earlier (summarised)` block + intro paragraphs up to the first
  // `## YYYY-` entry.
  const h1Idx = lines.findIndex(l => l.startsWith('# '));
  const firstEntryIdx = lines.findIndex((l, i) => i > 0 && /^## \d{4}-\d{2}-\d{2}/.test(l));
  if (firstEntryIdx < 0) return false;

  const headerBlock = lines.slice(0, firstEntryIdx).join('\n').trimEnd();
  const entriesBlock = lines.slice(firstEntryIdx).join('\n');

  // Split entries by `\n## YYYY-` (newest first, matching write order).
  const entries = entriesBlock.split(/(?=^## \d{4}-\d{2}-\d{2})/m).map(s => s.trimEnd()).filter(Boolean);
  if (entries.length <= KEEP_MOST_RECENT_ENTRIES) return false;

  const keep = entries.slice(0, KEEP_MOST_RECENT_ENTRIES);
  const evicted = entries.slice(KEEP_MOST_RECENT_ENTRIES);

  // Append evicted entries to lessons/<sprint>.md (oldest at bottom of the
  // appended block; oldest evicted first matches the original write order).
  const lessonsDir = join(REPO_ROOT, `agent-os/sub-agents/${agent}/lessons`);
  mkdirSync(lessonsDir, { recursive: true });
  const lessonPath = join(lessonsDir, `${sprint}.md`);
  const lessonHeader = existsSync(lessonPath)
    ? '\n\n<!-- additional rollover from sprint ' + sprint + ' -->\n\n'
    : `# Diary Rollover — ${agent} — Sprint ${sprint}\n\n` +
      `Evicted from \`diary.md\` on ${dayStr()} when the diary exceeded ${DIARY_LINE_CAP} lines.\n` +
      'Entries preserved verbatim in oldest-first order.\n\n';
  // Reverse evicted so older entries land first inside the lesson file
  appendFileSync(lessonPath, lessonHeader + evicted.slice().reverse().join('\n\n') + '\n', 'utf8');

  // Build the rollover marker. Honours MEMORY_DIARY_SUMMARISE flag:
  //   off  → just the see-lessons pointer (deterministic)
  //   on   → deterministic placeholder; an LLM-bound orchestrator can
  //          replace this with a real summary later by editing the same
  //          ## Earlier (summarised) section
  //   byok → BYOK API call (best-effort; on failure falls back to placeholder)
  const summariseFlag = (process.env.MEMORY_DIARY_SUMMARISE || 'on').toLowerCase();
  let summaryBody = `_(${evicted.length} entries evicted ${dayStr()}; preserved verbatim in [\`lessons/${sprint}.md\`](lessons/${sprint}.md). MEMORY_DIARY_SUMMARISE=${summariseFlag} — replace this block with a real summary when an LLM-bound orchestrator is wired.)_`;

  if (summariseFlag === 'byok') {
    try {
      summaryBody = byokSummarise(evicted.join('\n\n')) || summaryBody;
    } catch (e) {
      logTo(log, `rolloverDiary byok summary failed (${e.message}); using deterministic placeholder.`);
    }
  }

  const earlierSection = `## Earlier (summarised)\n\n${summaryBody}\n`;
  // Strip any pre-existing ## Earlier (summarised) section from the header
  // block to avoid stacking — the new section replaces it.
  const cleanedHeader = headerBlock.replace(/\n## Earlier \(summarised\)[\s\S]*?(?=\n## |\n# |$)/m, '').trimEnd();

  const next = `${cleanedHeader}\n\n${earlierSection}\n${keep.join('\n\n')}\n`;
  writeFileSync(diaryPath, next.replace(/\n{3,}/g, '\n\n'), 'utf8');
  logTo(log, `rolloverDiary: ${agent} -> ${evicted.length} entries moved to lessons/${sprint}.md (kept ${keep.length})`);
  return true;
}

function byokSummarise(text) {
  const provider = process.env.MEMORY_EMBEDDING_PROVIDER;
  const apiKey = process.env.MEMORY_EMBEDDING_API_KEY;
  if (!provider || !apiKey) return null;
  // Best-effort sync POST via curl to keep the script dependency-free in
  // a sync context; if curl is unavailable the catch in the caller wins.
  try {
    const truncated = text.slice(0, 4096);
    const body = JSON.stringify({
      model: 'haiku-fallback',
      messages: [
        { role: 'system', content: 'Summarise the following diary entries in ≤5 short bullet points capturing what would still matter to a future invocation of this agent.' },
        { role: 'user', content: truncated },
      ],
    });
    const out = execSync(
      `curl -sS -X POST -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" --data-binary @- ${provider}`,
      { input: body, encoding: 'utf8' }
    );
    const parsed = JSON.parse(out);
    return parsed?.choices?.[0]?.message?.content
        ?? parsed?.summary
        ?? null;
  } catch {
    return null;
  }
}

// ── Sprint completion fact ───────────────────────────────────────────
function emitCompletionFact(sprint, log) {
  try {
    execSync(
      `bash agent-os/scripts/facts-append.sh "Sprint ${sprint}|completed_at|${dayStr()}|${dayStr()}" --source "post-sprint-memory" --sprint "${sprint}"`,
      { stdio: 'pipe' }
    );
    logTo(log, `emitCompletionFact: Sprint ${sprint} completed_at=${dayStr()}`);
    return true;
  } catch (e) {
    logTo(log, `emitCompletionFact FAILED for ${sprint}: ${e.message}`);
    return false;
  }
}

// ── Process a single spawn-request ───────────────────────────────────
export function processOne(reqPath) {
  const log = join(LOG_DIR, 'process-spawn-requests.log');
  const fname = basename(reqPath);
  let req;
  try {
    req = JSON.parse(readFileSync(reqPath, 'utf8'));
  } catch (e) {
    logTo(log, `parse FAILED ${fname}: ${e.message} — leaving in queue.`);
    return { processed: false, reason: 'parse-failed' };
  }

  if (req.kind !== 'post-sprint-memory') {
    logTo(log, `skip ${fname}: kind=${req.kind} not handled by this processor.`);
    return { processed: false, reason: 'unknown-kind' };
  }

  const sprint = req.sprint || 'unknown';
  const head = req.head || 'HEAD';
  const branch = req.branch || '';
  const base = resolveBase(branch || head);

  const commitSubjects = base ? gitLog(base, head).split('\n').filter(Boolean) : [];
  const changedFiles = base ? gitDiffNames(base, head) : [];

  if (changedFiles.length === 0) {
    logTo(log, `process ${fname}: no diff vs base — recording completion fact only.`);
  }

  // Detect phase transitions once for the whole sprint (Sprint 46.6.9).
  const stateDiff = changedFiles.includes('agent-os/STATE.md')
    ? gitDiffOf(base, head, 'agent-os/STATE.md')
    : '';
  const phaseTransitions = detectPhaseTransitions(stateDiff);

  // Group files by agent
  const agentFilesMap = new Map();
  for (const f of changedFiles) {
    for (const ag of fileToAgents(f)) {
      if (!agentFilesMap.has(ag)) agentFilesMap.set(ag, []);
      agentFilesMap.get(ag).push(f);
    }
  }

  let writes = 0;
  let rollovers = 0;
  for (const [agent, files] of agentFilesMap) {
    if (appendDiaryEntry(agent, sprint, commitSubjects, files, log, { phaseTransitions })) {
      writes++;
      if (rolloverDiary(agent, sprint, log)) rollovers++;
    }
  }

  const factEmitted = emitCompletionFact(sprint, log);

  // Move to consumed/
  mkdirSync(CONSUMED_DIR, { recursive: true });
  const consumedPath = join(CONSUMED_DIR, fname);
  // Append a processed_at marker to the moved file for forensics
  const stamped = { ...req, processed_at: ts(), diary_writes: writes, rollovers, fact_emitted: factEmitted };
  writeFileSync(consumedPath, JSON.stringify(stamped, null, 2), 'utf8');
  // We've already written the stamped copy at consumedPath via writeFileSync
  // above. Remove the source. unlinkSync is platform-agnostic and avoids
  // any shell quoting ambiguity around Windows paths.
  try {
    unlinkSync(reqPath);
  } catch { /* ignore */ }
  logTo(log, `process ${fname}: writes=${writes} rollovers=${rollovers} fact_emitted=${factEmitted} -> consumed/${fname}`);

  return { processed: true, writes, rollovers, factEmitted };
}

// ── Entrypoint ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const ONCE = args.includes('--once');

if (!existsSync(QUEUE_DIR)) {
  console.log('process-spawn-requests: queue dir missing — nothing to do.');
  process.exit(0);
}

const requests = readdirSync(QUEUE_DIR)
  .filter(f => f.startsWith('post-sprint-memory-') && f.endsWith('.json'))
  .map(f => join(QUEUE_DIR, f))
  .filter(p => statSync(p).isFile())
  .sort();

if (requests.length === 0) {
  console.log('process-spawn-requests: 0 pending requests.');
  process.exit(0);
}

let processed = 0;
let totalWrites = 0;
let totalRollovers = 0;
for (const reqPath of requests) {
  const result = processOne(reqPath);
  if (result.processed) {
    processed++;
    totalWrites += result.writes || 0;
    totalRollovers += result.rollovers || 0;
  }
  if (ONCE) break;
}

console.log(`process-spawn-requests: processed=${processed} diary-writes=${totalWrites} rollovers=${totalRollovers}`);
