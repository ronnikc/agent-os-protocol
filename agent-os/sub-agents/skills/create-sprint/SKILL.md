Title: Create Sprint
Keywords: work-item, sprint, authoring, canonical-schema, create-sprint
Slug: create-sprint
Scope: Author a new Sprint in the canonical work-item schema (the single on-disk format)
Last updated: Phase 4

Owns the rules for creating a **Sprint** under a phase so it conforms to the canonical schema
(§12A). Drives `agent-os/scripts/work-items.ts`.

---

## Rules

- **Id:** semver `X.Y.Z` (e.g. `1.0.0`). The phase must already exist.
- **Status:** one of `planned | in_progress | blocked | complete | cancelled`.
- **On disk:** `agent-os/work-items/phase-N/sprint-X.Y.Z.md` with front-matter
  (`id`, `title`, `phase`, `status`, optional `owner`) **plus a `## Tasks` section** — the
  single task syntax. The engine writes this; do not invent alternate layouts.

## How

```bash
npx tsx agent-os/scripts/work-items.ts create-sprint \
  --phase phase-3 --id 3.0.0 --title "Foundations" --owner planning --status planned
```

Then add tasks with [create-task](../create-task/SKILL.md). The contract sections (Goal, ACs,
Out-of-Scope, Dependencies) belong in the sprint body and are checked by `lint-sprint-contract.sh`.

## Acceptance

- Produces a conformant `sprint-X.Y.Z.md` with front-matter + a `## Tasks` section.
- `work-items.ts validate` passes; the sprint appears under its phase in `parse`.
