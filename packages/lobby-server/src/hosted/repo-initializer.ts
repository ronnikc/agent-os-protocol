// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * Repo initializer — collects the Agent OS structure a connected GitHub repository needs so the
 * hosted lobby can manage agents there: agent definitions (+ bound Agent IDs), skills, scheduled
 * self-learning prompts, the scheduler config, and the scaffolding directories for shared memories
 * and locally trained packs. The lobby "clones down" these parts of Agent OS into the user's OWN
 * repo in one batch commit; the repo — not the lobby host — is the durable home for everything the
 * swarm learns and is taught.
 *
 * Pure collection logic (local FS → file list) so it is unit-testable; the server owns the GitHub
 * side (existence filtering + the atomic commit).
 */

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

export interface SeedFile { path: string; content: string }

/** Marker manifest — its presence in a repo means the Agent OS structure has been initialized. */
export const AGENT_OS_MANIFEST_PATH = 'agent-os/.agent-os.json';

export function buildManifest(initializedBy: string): string {
  // PRIVACY: the manifest lands in the user's repo — which may be PUBLIC. Store only a short
  // fingerprint of the initializing wallet ref, never the raw address/DID; the full attribution
  // stays in the lobby's private event log. Nothing else the initializer seeds is sensitive:
  // agent definitions/skills/prompts are public upstream content, and no tokens or provider keys
  // are ever written to the repo.
  const fingerprint = createHash('sha256').update(initializedBy).digest('hex').slice(0, 12);
  return JSON.stringify({
    initialized_at: new Date().toISOString(),
    initialized_by_fingerprint: fingerprint,
    components: ['agents', 'skills', 'scheduled-prompts', 'config', 'shared-memory', 'training-packs', 'planning', 'readme'],
  }, null, 2) + '\n';
}

const DEFAULT_CONFIG = JSON.stringify({
  scheduled: [
    { name: 'graph-update', enabled: false, time_utc: '03:00' },
    { name: 'pr-quality-review', enabled: false, time_utc: '04:00' },
    { name: 'fix-sprint-executor', enabled: false, time_utc: '05:00' },
  ],
}, null, 2) + '\n';

const ROOT_README = `# Agent OS Managed Repository

This repository is connected to a **hosted Agent OS lobby** via the Agent OS GitHub App. A swarm of
AI agents coordinates here under a human LobbyOwner: agents read this repo, do file work through
scoped repository tools, and land changes as commits and pull requests.

Everything the lobby manages lives under [\`agent-os/\`](agent-os/):

| Path | What it holds |
|---|---|
| \`agent-os/sub-agents/agents/\` | Agent definitions — the launchable roster; bound Agent IDs (\`Identity:\` lines) |
| \`agent-os/sub-agents/skills/\` | Skills agents can invoke |
| \`agent-os/scheduled/\` + \`agent-os/config.json\` | Scheduled self-learning tasks |
| \`agent-os/shared-memory/\` | Shared memories written by the swarm |
| \`agent-os/training/packs/\` | Locally trained agent packs promoted to the repo |
| \`agent-os/planning.json\` | Phases → sprints plan (drives the Panel's Gantt view) |

Learn more: [Agent OS Protocol](https://github.com/ronnikc/agent-os-protocol).
`;

const AGENT_OS_README = `# agent-os/

The Agent OS structure for this repository — seeded by the hosted lobby's **Initialize** action and
maintained by the swarm + the LobbyOwner. Files here are plain markdown/JSON: review, edit, and
prune them like any other code. Custom edits are never overwritten by re-initialization.
`;

/**
 * Phases → sprints plan consumed by the Panel's Gantt view. Starts empty by design; shape:
 * { phases: [{ id, name, status: 'planned'|'active'|'complete', sprints: [{ id, name, status }] }] }
 */
const PLANNING_TEMPLATE = JSON.stringify({ phases: [] }, null, 2) + '\n';

const SHARED_MEMORY_README = `# Shared Memory

Durable memories your lobby's agents write and retrieve — facts, lessons, and diaries land here as
markdown/JSONL so they survive agent restarts and travel with the repository. Managed by the
hosted lobby (Knowledge Base + self-learning); safe to read, review, and prune by hand.
`;

const TRAINING_PACKS_README = `# Training Packs

Locally trained agent packs (\`/train\`) are stored here when promoted to the repository — each
pack teaches agents domain knowledge from your own docs. Reviewable and reversible: delete a pack
directory to un-teach it.
`;

/**
 * Collect every seed file from this deployment's own Agent OS tree. Returned paths are
 * repo-relative. Fails soft per component — a deployment without skills still seeds agents.
 */
export function collectAgentOsSeed(repoRoot: string): SeedFile[] {
  const files: SeedFile[] = [];
  const add = (path: string, content: string) => files.push({ path, content });

  const readDirSafe = (p: string): string[] => { try { return readdirSync(p); } catch { return []; } };
  const readSafe = (p: string): string | null => { try { return readFileSync(p, 'utf-8'); } catch { return null; } };

  // Agent definitions — the roster the lobby launches from, and where Agent IDs get bound.
  const agentsDir = join(repoRoot, 'agent-os/sub-agents/agents');
  for (const f of readDirSafe(agentsDir).filter(f => f.endsWith('.md'))) {
    const content = readSafe(join(agentsDir, f));
    if (content !== null) add(`agent-os/sub-agents/agents/${f}`, content);
  }

  // Skills — generic capabilities agents can invoke; one SKILL.md per skill directory.
  const skillsDir = join(repoRoot, 'agent-os/sub-agents/skills');
  for (const d of readDirSafe(skillsDir)) {
    const skillFile = join(skillsDir, d, 'SKILL.md');
    try {
      if (statSync(join(skillsDir, d)).isDirectory() && existsSync(skillFile)) {
        const content = readSafe(skillFile);
        if (content !== null) add(`agent-os/sub-agents/skills/${d}/SKILL.md`, content);
      }
    } catch { /* skip unreadable skill */ }
  }
  const subAgentsReadme = readSafe(join(repoRoot, 'agent-os/sub-agents/README.md'));
  if (subAgentsReadme !== null) add('agent-os/sub-agents/README.md', subAgentsReadme);

  // Scheduled self-learning prompts + default scheduler config.
  const promptsDir = join(repoRoot, 'agent-os/scheduled/prompts');
  for (const f of readDirSafe(promptsDir).filter(f => f.endsWith('.md'))) {
    const content = readSafe(join(promptsDir, f));
    if (content !== null) add(`agent-os/scheduled/prompts/${f}`, content);
  }
  add('agent-os/config.json', DEFAULT_CONFIG);

  // Scaffolding for memories and locally trained packs.
  add('agent-os/shared-memory/README.md', SHARED_MEMORY_README);
  add('agent-os/training/packs/README.md', TRAINING_PACKS_README);

  // Orientation READMEs (skip-if-exists protects real projects' own README) + planning scaffold.
  add('README.md', ROOT_README);
  add('agent-os/README.md', AGENT_OS_README);
  add('agent-os/planning.json', PLANNING_TEMPLATE);

  return files;
}
