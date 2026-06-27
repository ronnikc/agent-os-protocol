Title: Train
Keywords: train, skill-authoring, knowledge-pack, secret-detection, provenance, reversible-training
Slug: train
Scope: Drive the `/train` flow — convert user-supplied material into reviewable, reversible skills for an agent
Last updated: Phase 3

This skill drives `agent-os/scripts/train.mjs`, the deterministic engine behind `/train`. Owned
by the [Training Agent](../../agents/training.md). It turns a user's document into a **reviewable,
reversible** skill draft for a target agent (usually `domain-specialist`).

---

## When to use

When the user wants to teach an agent new knowledge from their own docs, checklists, patterns, or
playbooks — without baking that knowledge into the core distribution.

## Flow (always review before activation)

1. **Confirm** the target agent slug and the source file with the user.
2. **Dry-run first** and show the plan — this writes nothing:
   ```bash
   node agent-os/scripts/train.mjs <agent> --source <file> [--skill <name>] --dry-run
   ```
3. **Create the draft** on approval (drop `--dry-run`). The engine **rejects** any source that
   contains secrets and logs the rejection to `agent-os/training/rejected/`.
4. **Review** the generated `SKILL.md` with the user. The draft imports the source verbatim under
   `## Knowledge`; refine it into actionable guidance (rules, checklists, patterns) for the agent.
5. **Activate explicitly** once reviewed:
   ```bash
   node agent-os/scripts/train.mjs <agent> --activate <skill>
   ```
6. **Manage**: `--list`, `--deactivate <skill>`, `--remove <skill>`.

## Safety (non-negotiable)

- The engine writes **only** under `agent-os/training/`, `agent-os/sub-agents/skills/trained/`,
  and `agent-os/memories/trained/`. It never overwrites core rules or any other agent.
- Drafts and trained packs are **user-local by default** (gitignored); committing is an explicit
  opt-in.
- **Secret detection** scans every source for keys, tokens, passwords, and `.env`-style
  assignments; matches are rejected (exit code 2) and never written into a skill.
- Every artifact records provenance (source path, sha256, dates) in `metadata.json`.

## Acceptance

- `--dry-run` writes nothing and prints the exact files it would create.
- A clean source produces a reviewable draft under `training/inbox/<agent>/<skill>/`.
- A source with a secret is rejected and logged.
- Activation is explicit; unrelated agents are never modified.
