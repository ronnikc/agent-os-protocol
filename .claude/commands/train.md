---
description: Teach an agent new domain knowledge from your own docs (reviewable, reversible, secret-safe)
---

Run the Agent OS Protocol training flow for: $ARGUMENTS

Follow this sequence — never skip the review step:

1. Parse the **target agent slug** and the **source** from the arguments
   (e.g. `domain-specialist --source ./docs/my-domain.md --skill privacy-basics`).
   If the agent or source is missing or ambiguous, ask before proceeding.

2. **Dry-run first** and show the user the plan (this writes nothing):
   ```bash
   node agent-os/scripts/train.mjs <agent> --source <file> [--skill <name>] --dry-run
   ```

3. After the user approves, **create the reviewable draft** (drop `--dry-run`).
   The engine **rejects** any source containing secrets (keys/tokens/passwords/.env).

4. Open the generated `SKILL.md`, **review it with the user**, and refine the verbatim import
   into actionable guidance for the agent.

5. **Activate only on explicit approval:**
   ```bash
   node agent-os/scripts/train.mjs <agent> --activate <skill>
   ```

Constraints: never modify core rules or other agents; trained content is user-local by default.
See `agent-os/sub-agents/agents/training.md` and `agent-os/sub-agents/skills/train/SKILL.md`.
