Title: Create Phase
Keywords: work-item, phase, authoring, canonical-schema, create-phase
Slug: create-phase
Scope: Author a new Phase in the canonical work-item schema (the single on-disk format)
Last updated: Phase 4

Owns the rules for creating a **Phase** so it conforms to the canonical schema the single
`parseWorkItems` reader expects (§12A). Drives `agent-os/scripts/work-items.ts`.

---

## Rules

- **Id:** `phase-N` (e.g. `phase-3`). No other form.
- **Status:** one of `planned | in_progress | blocked | complete | cancelled`.
- **On disk:** `agent-os/work-items/phase-N/README.md` with YAML front-matter
  (`id`, `name`, `status`) — written by the engine, never hand-rolled.

## How

```bash
npx tsx agent-os/scripts/work-items.ts create-phase --id phase-3 --name "Training" --status planned
# or: npm run work-items -- create-phase --id phase-3 --name "Training"
```

The engine refuses a malformed id/status and refuses to overwrite an existing phase. After
creating, add sprints with [create-sprint](../create-sprint/SKILL.md).

## Acceptance

- Produces `agent-os/work-items/phase-N/README.md` with valid front-matter.
- `work-items.ts validate` passes; `work-items.ts parse` shows the phase.
