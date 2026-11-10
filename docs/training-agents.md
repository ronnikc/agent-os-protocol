<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 R Digital -->

# Training agents (`/train`)

The base platform ships **no domain knowledge** — agents are generic specialists (planning,
backend, frontend, test, security, docs, …) plus a generic **Domain Specialist**. You teach them
your domain from your own documents with `/train`. Training is **reviewable, reversible, and local
by default**, and it **never** modifies core rules or other agents.

## The model

```
your docs ──▶ dry-run (plan only) ──▶ reviewable draft ──▶ you review ──▶ activate
                                          │
                                   secret detection rejects keys/tokens/.env
```

- **Drafts** land in `agent-os/training/inbox/` and `agent-os/sub-agents/skills/trained/<agent>/`.
- **Active** trained skills live under the agent's trained skill directory and are picked up at
  runtime alongside the agent's built-in skills.
- **User-local by default** — `training/inbox`, `training/reviewed`, `skills/trained/`, and
  `memories/trained/` are gitignored; you opt in explicitly to commit a reviewed pack.

## Quick start

Always **dry-run first** — it writes nothing and shows you the plan:

```bash
node agent-os/scripts/train.mjs domain-specialist --source ./docs/my-domain.md --dry-run
```

Create the reviewable draft (drop `--dry-run`). The engine **rejects** any source that contains
secrets (API keys, tokens, passwords, `.env` contents):

```bash
node agent-os/scripts/train.mjs domain-specialist --source ./docs/my-domain.md --skill my-domain
```

Open the generated `SKILL.md`, refine the verbatim import into actionable guidance (rules,
checklists, patterns), then **activate on purpose**:

```bash
node agent-os/scripts/train.mjs domain-specialist --activate my-domain
```

## Command reference

```bash
# Create a draft from a source document
node agent-os/scripts/train.mjs <agent-slug> --source <file> [--skill <name>] [--mode review|append] [--dry-run]

# Activate / manage trained skills
node agent-os/scripts/train.mjs <agent-slug> --activate   <skill>
node agent-os/scripts/train.mjs <agent-slug> --deactivate <skill>   # keeps the draft for re-activation
node agent-os/scripts/train.mjs <agent-slug> --remove     <skill>   # removes draft + active
node agent-os/scripts/train.mjs <agent-slug> --list                 # drafts + active for an agent
```

| Flag | Meaning |
|---|---|
| `--source <file>` | The document to learn from (Markdown, text, code, API docs, checklists, …) |
| `--skill <name>` | Name for the generated skill (derived from the source if omitted) |
| `--mode review\|append` | `review` (default) creates a draft to review; `append` extends an existing skill |
| `--dry-run` | Print the planned writes and exit — writes nothing |
| `--activate <skill>` | Promote a reviewed draft to an active trained skill |
| `--deactivate <skill>` | Deactivate an active skill (the draft remains for re-activation) |
| `--remove <skill>` | Delete both the draft and the active skill |
| `--list` | Show an agent's draft and active trained skills |

`npm run train` is wired to the same script.

## Using the `/train` slash command

Inside an interactive Claude Code session, `/train` runs the same flow and **forces the review
step**:

```
/train domain-specialist --source ./docs/my-domain.md --skill my-domain
```

It parses the target agent + source, dry-runs and shows you the plan, creates the draft only after
you approve, helps you review the `SKILL.md`, and activates only on explicit approval. The command
definition is [`.claude/commands/train.md`](../.claude/commands/train.md).

## Which agent should I train?

- **`domain-specialist`** — the catch-all for a business/regulatory/product domain the platform
  doesn't know. Start here for "teach it about *my* field."
- **A specific specialist** (e.g. `backend`, `security`, `test`) — when the knowledge is a
  refinement of that role's craft (a house API style, a security checklist, a test convention).

List the roster in the panel (**Agents** tab) or under
[`agent-os/sub-agents/agents/`](../agent-os/sub-agents/agents/).

## Safety guarantees

- **Core rules are untouchable** — training writes only under `training/` and the agent's *trained*
  skill directory; it never edits `RULES.md`, governance, or another agent's definition.
- **Secret detection** — a source containing keys/tokens/passwords/`.env` material is rejected
  before anything is written.
- **Reversible** — deactivate or remove a trained skill at any time; the agent returns to its prior
  behaviour.
- **Provenance** — generated drafts record their source and date, so you can see where a piece of
  knowledge came from.
- **Local by default** — nothing trained is committed unless you explicitly choose to.

See the [security model](security.md) for how trained content and secrets are kept local, and the
Training Agent definition at [`agent-os/sub-agents/agents/training.md`](../agent-os/sub-agents/agents/training.md).

---

Licensed under **Apache-2.0** · © 2026 R Digital.
