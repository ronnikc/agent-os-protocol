#!/usr/bin/env node
// self-learning-review.mjs — post-merge self-improvement pass for Agent OS Protocol.
//
// Runs after a PR/merge lands and closes the "did we learn anything?" loop that the
// sprint-only memory hook missed for arbitrary PRs. For a git range it:
//   1. Updates memories — diaries + facts — over the exact range (via the existing
//      process-spawn-requests engine, given a precise base).
//   2. Refreshes the dependency graph for the changed files.
//   3. Runs a SKILLS REVIEW — maps changed files to owning agents, cross-references the
//      committed skills index, and writes a reviewable report proposing which skills to
//      add or update. It recommends; it never auto-creates skills (reviewable + reversible,
//      matching /train's contract).
//   4. Emits a `self_learning_reviewed` fact for the range.
//
// Deterministic by default (no LLM) — same philosophy as process-spawn-requests. The report
// is a human/agent decision aid, committed under agent-os/self-learning/reviews/.
//
// Usage:
//   node agent-os/scripts/self-learning-review.mjs [--base <ref>] [--head <ref>]
//                                                   [--title "<pr title>"] [--pr <n>]
//                                                   [--dry-run] [--no-memory] [--no-graph]
// Defaults: head = HEAD; base = ORIG_HEAD (post-merge) → merge-base(main,HEAD) → HEAD~1.
// Exit: 0 always (never blocks a merge).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fileToAgents } from './process-spawn-requests.mjs';

const REPO_ROOT = process.cwd();
const SKILLS_DIR = join(REPO_ROOT, 'agent-os/sub-agents/skills');
const REVIEW_DIR = join(REPO_ROOT, 'agent-os/self-learning/reviews');
const QUEUE_DIR = join(REPO_ROOT, '.claude/spawn-requests');

// ── CLI ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { dryRun: false, memory: true, graph: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') o.base = argv[++i];
    else if (a === '--head') o.head = argv[++i];
    else if (a === '--title') o.title = argv[++i];
    else if (a === '--pr') o.pr = argv[++i];
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-memory') o.memory = false;
    else if (a === '--no-graph') o.graph = false;
  }
  return o;
}

function sh(cmd, fallback = '') {
  try { return execSync(cmd, { encoding: 'utf8' }).trim(); } catch { return fallback; }
}

function resolveRange(opts) {
  const head = opts.head || 'HEAD';
  let base = opts.base;
  if (!base) {
    // Post-merge: ORIG_HEAD is the pre-merge tip → ORIG_HEAD..HEAD is the merged range.
    base = sh('git rev-parse --verify --quiet ORIG_HEAD');
    if (!base) base = sh('git merge-base main HEAD');
    if (!base) base = sh('git rev-parse HEAD~1');
  }
  return { base, head };
}

// ── Skills index ────────────────────────────────────────────────────
function loadSkillSlugs() {
  const slugs = new Set();
  // Directory names are the source of truth.
  if (existsSync(SKILLS_DIR)) {
    for (const e of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(SKILLS_DIR, e.name, 'SKILL.md'))) slugs.add(e.name);
    }
  }
  return slugs;
}

// ── Subsystem detection ─────────────────────────────────────────────
// Group changed files into named subsystems so we can reason at the right altitude.
function subsystemOf(path) {
  const pkg = path.match(/^packages\/([^/]+)\//);
  if (pkg) return `packages/${pkg[1]}`;
  const app = path.match(/^apps\/([^/]+)\//);
  if (app) return `apps/${app[1]}`;
  if (path.startsWith('agent-os-panel/')) return 'agent-os-panel';
  if (path.startsWith('agent-os/sub-agents/skills/')) return 'skills';
  if (path.startsWith('agent-os/scripts/')) return 'agent-os/scripts';
  if (path.startsWith('agent-os/')) return 'agent-os/governance';
  if (path.startsWith('docs/')) return 'docs';
  return 'other';
}

// Tokens that hint at a reusable engineering capability worth a skill. Maps a keyword
// to the skill slug that should cover it (if the slug is absent, recommend adding it).
const CAPABILITY_HINTS = [
  { re: /concordium|wallet|ccd\b/i, slug: 'concordium-wallet-integration', label: 'Concordium wallet integration' },
  { re: /registry|cis-?8004|agent-card|mint/i, slug: 'agent-registry-minting', label: 'Agent Registry minting' },
  { re: /\bmcp\b|model-context-protocol/i, slug: 'mcp-server-config', label: 'MCP server configuration' },
  { re: /lobby|coordinator|floor-control|hand-raise/i, slug: 'lobby-orchestration', label: 'Lobby orchestration' },
  { re: /adapter|runtime|claude-cli|codex-cli/i, slug: 'runtime-adapter-integration', label: 'Runtime adapter integration' },
  { re: /websocket|ws-|reconnect|heartbeat/i, slug: 'realtime-websocket-protocol', label: 'Realtime WebSocket protocol' },
];

function classifyCommits(subjects) {
  const counts = { feat: 0, fix: 0, refactor: 0, docs: 0, test: 0, other: 0 };
  for (const s of subjects) {
    const m = s.match(/^(feat|fix|refactor|docs|test|chore|perf|ci|build)/i);
    const t = m ? m[1].toLowerCase() : 'other';
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}

// ── Skills recommendations ──────────────────────────────────────────
function buildRecommendations({ changedFiles, addedFiles, commitSubjects, slugs }) {
  const recs = [];
  const commitBlob = commitSubjects.join('\n');
  const fileBlob = changedFiles.join('\n');

  // 1) Capability hints present in paths/commits but not covered by an existing skill.
  for (const hint of CAPABILITY_HINTS) {
    if (hint.re.test(fileBlob) || hint.re.test(commitBlob)) {
      if (!slugs.has(hint.slug)) {
        recs.push({
          kind: 'add',
          skill: hint.slug,
          reason: `Changes touch "${hint.label}" but no committed skill "${hint.slug}" covers it.`,
        });
      } else {
        // Skill exists — recommend a review/update when the change was a bug fix (new gotcha).
        const fixish = /^fix/im.test(commitBlob);
        if (fixish) {
          recs.push({
            kind: 'update',
            skill: hint.slug,
            reason: `Bug fix(es) in the "${hint.label}" area — capture the new failure mode in "${hint.slug}" (Error Handling / Quality Gate).`,
          });
        }
      }
    }
  }

  // 2) A brand-new package directory with no matching skill → likely a new capability.
  const newPkgs = new Set();
  for (const f of addedFiles) {
    const m = f.match(/^packages\/([^/]+)\//);
    if (m) newPkgs.add(m[1]);
  }
  for (const p of newPkgs) {
    const hasSkill = [...slugs].some((s) => s.includes(p) || p.includes(s.split('-')[0]));
    if (!hasSkill) {
      recs.push({
        kind: 'add',
        skill: `${p}-integration`,
        reason: `New package "packages/${p}" introduced with no owning skill — consider an engineering skill for it.`,
      });
    }
  }

  // De-dupe by (kind, skill).
  const seen = new Set();
  return recs.filter((r) => {
    const k = `${r.kind}:${r.skill}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Report ──────────────────────────────────────────────────────────
function renderReport({ title, pr, base, head, commitSubjects, changedFiles, agentFiles, commitCounts, recs }) {
  const day = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`# Self-Learning Review — ${day}`);
  lines.push('');
  if (title) lines.push(`**PR:** ${pr ? `#${pr} — ` : ''}${title}`);
  lines.push(`**Range:** \`${base.slice(0, 10)}..${head.slice(0, 10)}\``);
  lines.push(`**Commits:** ${commitSubjects.length} · **Files changed:** ${changedFiles.length}`);
  lines.push(`**Commit mix:** ${Object.entries(commitCounts).filter(([, n]) => n).map(([t, n]) => `${t}×${n}`).join(', ') || 'n/a'}`);
  lines.push('');

  lines.push('## Affected agents');
  const agentEntries = Object.entries(agentFiles).sort((a, b) => b[1].length - a[1].length);
  if (agentEntries.length === 0) {
    lines.push('_No owned files changed._');
  } else {
    for (const [agent, files] of agentEntries) {
      lines.push(`- **${agent}** — ${files.length} file(s): ${files.slice(0, 6).map((f) => `\`${f}\``).join(', ')}${files.length > 6 ? ' …' : ''}`);
    }
  }
  lines.push('');

  lines.push('## Skills to add / update');
  if (recs.length === 0) {
    lines.push('_No new skills recommended by the heuristics for this range. (Absence of a recommendation is not proof none is warranted — a reviewing agent may still add one.)_');
  } else {
    for (const r of recs) {
      lines.push(`- **[${r.kind.toUpperCase()}] \`${r.skill}\`** — ${r.reason}`);
    }
  }
  lines.push('');
  lines.push('> Recommendations only. To act: author/update the skill under');
  lines.push('> `agent-os/sub-agents/skills/<slug>/SKILL.md` (v1.1.0 layout) and add its row to the index,');
  lines.push('> or teach an agent from your own docs with `/train`.');
  lines.push('');

  lines.push('## Memory');
  lines.push('- Diaries + completion fact written by `process-spawn-requests` over this range (per affected agent above).');
  lines.push('- Dependency graph refreshed for the changed files.');
  lines.push('');
  return lines.join('\n');
}

// ── Memory + graph orchestration ─────────────────────────────────────
function updateMemory({ base, head, pr, dryRun }) {
  const shortHead = head === 'HEAD' ? sh('git rev-parse --short HEAD') : head.slice(0, 10);
  const sprint = `pr-${pr || shortHead}`;
  const branch = sh('git rev-parse --abbrev-ref HEAD') || 'HEAD';
  const req = {
    kind: 'post-sprint-memory',
    sprint,
    requested_at: new Date().toISOString(),
    branch,
    head: head === 'HEAD' ? sh('git rev-parse HEAD') : head,
    base,
    source: 'self-learning-review',
  };
  if (dryRun) return { sprint, wrote: false };
  mkdirSync(QUEUE_DIR, { recursive: true });
  const reqPath = join(QUEUE_DIR, `post-sprint-memory-${sprint}.json`);
  writeFileSync(reqPath, JSON.stringify(req, null, 2));
  // Process just this request through the shared engine.
  try {
    execSync('node agent-os/scripts/process-spawn-requests.mjs --once', { stdio: 'inherit' });
  } catch { /* never block */ }
  return { sprint, wrote: true };
}

function updateGraph({ base, dryRun }) {
  if (dryRun) return;
  try {
    execSync(`bash agent-os/scripts/graph-update.sh --base ${base}`, { stdio: 'inherit' });
  } catch { /* never block */ }
}

function emitFact({ head, pr, dryRun }) {
  if (dryRun) return;
  const day = new Date().toISOString().slice(0, 10);
  const shortHead = head === 'HEAD' ? sh('git rev-parse --short HEAD') : head.slice(0, 10);
  const subj = `PR ${pr || shortHead}`;
  try {
    execSync(
      `bash agent-os/scripts/facts-append.sh "${subj}|self_learning_reviewed|${day}|${day}" --source "self-learning-review" --sprint "${shortHead}"`,
      { stdio: 'pipe' }
    );
  } catch { /* never block */ }
}

// ── Main ─────────────────────────────────────────────────────────────
export function run(argv) {
  const opts = parseArgs(argv);
  const { base, head } = resolveRange(opts);
  if (!base) {
    console.log('self-learning-review: could not resolve a base ref — nothing to review.');
    return { ok: true, empty: true };
  }

  const commitSubjects = sh(`git log --format=%s ${base}..${head}`).split('\n').filter(Boolean);
  const changedFiles = sh(`git diff --name-only ${base}..${head}`).split('\n').filter(Boolean);
  const addedFiles = sh(`git diff --name-only --diff-filter=A ${base}..${head}`).split('\n').filter(Boolean);

  if (changedFiles.length === 0) {
    console.log(`self-learning-review: no diff in ${base.slice(0, 10)}..${head.slice(0, 10)} — nothing to review.`);
    return { ok: true, empty: true };
  }

  // Map files → owning agents.
  const agentFiles = {};
  for (const f of changedFiles) {
    for (const a of fileToAgents(f)) {
      (agentFiles[a] ||= []).push(f);
    }
  }

  const slugs = loadSkillSlugs();
  const commitCounts = classifyCommits(commitSubjects);
  const recs = buildRecommendations({ changedFiles, addedFiles, commitSubjects, slugs });

  const report = renderReport({
    title: opts.title, pr: opts.pr, base, head, commitSubjects, changedFiles, agentFiles, commitCounts, recs,
  });

  const day = new Date().toISOString().slice(0, 10);
  const shortHead = head === 'HEAD' ? sh('git rev-parse --short HEAD') : head.slice(0, 10);
  const reportPath = join(REVIEW_DIR, `${day}-${shortHead}.md`);
  if (!opts.dryRun) {
    mkdirSync(REVIEW_DIR, { recursive: true });
    writeFileSync(reportPath, report);
  }

  if (opts.memory) updateMemory({ base, head, pr: opts.pr, dryRun: opts.dryRun });
  if (opts.graph) updateGraph({ base, dryRun: opts.dryRun });
  emitFact({ head, pr: opts.pr, dryRun: opts.dryRun });

  console.log(`self-learning-review: ${changedFiles.length} files, ${Object.keys(agentFiles).length} agents, ${recs.length} skill recommendation(s).`);
  console.log(opts.dryRun ? '(dry-run — no files written)' : `report: ${reportPath}`);
  return { ok: true, reportPath, agents: Object.keys(agentFiles), recs, report };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) run(process.argv.slice(2));
