Title: Create Task
Keywords: work-item, task, authoring, canonical-schema, create-task
Slug: create-task
Scope: Author a new Task in the canonical work-item schema (the single checkbox syntax)
Last updated: Phase 4

Owns the rules for creating a **Task** in a sprint so it conforms to the canonical schema
(§12A). Drives `agent-os/scripts/work-items.ts`. A task created this way carries a stable id and
appears under its sprint everywhere (Panel, Gantt, lobby, UI Assist) — no multi-syntax guessing.

---

## Rules

- **Identity:** a stable `id` (auto `T-xxxxxx`, or pass `--id`). The same id is carried in the
  markdown checkbox, the tasks store, and the lobby.
- **Status:** `planned | in_progress | blocked | complete | cancelled` (a `[x]` checkbox means
  `complete`). **Priority:** `low | normal | high | critical`.
- **The one task syntax** (appended to the sprint's `## Tasks` section):
  ```
  - [ ] <id> <title> (priority:high, assignee:backend)
  ```

## How

```bash
npx tsx agent-os/scripts/work-items.ts create-task \
  --phase phase-3 --sprint 3.0.0 --title "Wire the relay adapter" --priority high --assignee backend
```

The engine appends to the existing `## Tasks` section in place (it never rewrites the sprint
body). Whoever creates a task — the Planning agent, the Gantt menu, the Sprint planner, UI
Assist, or the lobby — uses this same contract.

## Acceptance

- Appends a single conformant checkbox line carrying a stable id.
- `work-items.ts parse` shows the task under its sprint; `validate` passes.
