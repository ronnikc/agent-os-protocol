Title: Sprint Decomposition
Keywords: sprint, decomposition, tasks, planning, acceptance-criteria, dependency
Agents: planning, product
When to use: When breaking a sprint spec into implementable tasks with agent assignments and dependency ordering.
Version: 1.0.0
Last updated: 2026-03-10

Break sprint specs into sized, ordered, agent-routed tasks. Read the sprint spec, extract acceptance criteria, map each to the owning agent, size the work, order by dependency chain (shared types first, then backend, frontend, tests, docs), and produce a structured task table.

---

## Workflow

### Step 1 — Read the Sprint Spec

Read the sprint file from `docs/product/phases/phase-N/sprint-X.Y.Z.md`. Extract:

- **Sprint number and title**
- **Acceptance criteria** (the numbered or bulleted AC list)
- **New modules or entities** introduced
- **API endpoints** added or modified
- **UI pages or components** added or modified
- **Seed data** requirements
- **i18n keys** needed

### Step 2 — Extract Acceptance Criteria

List every acceptance criterion verbatim. Each AC becomes one or more tasks. Do not merge ACs — keep them traceable.

### Step 3 — Map to Agent Ownership

For each task, assign the owning agent based on source directory:

| Agent | Owns | Typical tasks |
|-------|------|---------------|
| Backend | `src/backend/` | Services, routes, seed data, indexes, audit events |
| Frontend | `src/frontend/` | Pages, components, navigation, routes, forms |
| Security | Throughout | RBAC permissions, auth middleware, data classification |
| Compliance | Throughout | Audit trail events, legal timelines, evidence collection |
| Infrastructure | Project root | Docker, CI/CD, deployment, monitoring |

Cross-cutting tasks get a lead agent with explicit hand-off (see CLAUDE.md Agent Routing Rules).

### Step 4 — Size Each Task

| Size | Definition | Typical scope |
|------|-----------|---------------|
| Small (S) | < 50 lines changed, single file | Add permission constant, add nav item, add i18n keys |
| Medium (M) | 50–200 lines, 2–5 files | New service method, new page component, new route |
| Large (L) | 200+ lines, 5+ files | New module end-to-end, complex form wizard, new seed file |

### Step 5 — Order by Dependency

Always follow this implementation order:

1. **Shared types** — `src/shared/src/types/` and `src/shared/src/constants/`
2. **Build shared** — `npx tsc -p src/shared/tsconfig.json`
3. **Backend indexes** — `src/backend/src/db/indexes.ts`
4. **Backend seed data** — permissions in `seed-roles.ts`, sample data
5. **Backend services** — `src/backend/src/modules/<module>/`
6. **Backend routes** — route files, wired into `app.ts`
7. **Frontend API client** — methods in `api-client.ts`
8. **Frontend pages** — `src/frontend/src/pages/admin/<module>/`
9. **Frontend navigation** — `AdminLayout.tsx`
10. **Frontend routes** — `App.tsx`
11. **i18n translations** — all 16 locale files
12. **Tests** — backend service tests, frontend component tests
13. **Documentation** — sprint release notes, doc updates

### Step 6 — Produce Task Table

Output format:

| # | Task | Agent | Size | Dependencies | Files |
|---|------|-------|------|--------------|-------|
| 1 | Add shared types for `<module>` | Backend | S | — | `src/shared/src/types/<module>.ts` |
| 2 | Add permissions constants | Backend | S | 1 | `src/shared/src/constants/permissions.ts` |
| 3 | Build shared | Backend | S | 2 | — |
| 4 | Create `<module>` service | Backend | M | 3 | `src/backend/src/modules/<module>/<module>-service.ts` |
| ... | ... | ... | ... | ... | ... |

### Rules

- Every AC must map to at least one task. If an AC maps to zero tasks, flag it.
- Never combine backend and frontend work into a single task.
- Always include an i18n task if any new UI text is introduced.
- Always include a test task for every new service and every new page.
- Respect the max 2 parallel agents constraint (see `engineering-sub-agent-rules.md`).
- Include explicit file paths — do not leave them for agents to discover.

## Input Schema

```yaml
input:
  sprint_spec_path:
    type: string
    required: true
    description: "Path to the sprint spec file (e.g., docs/product/phases/phase-N/sprint-X.Y.Z.md)"
  max_parallel_agents:
    type: integer
    required: false
    default: 2
    description: "Maximum number of agents that can work in parallel (per engineering-sub-agent-rules.md)"
  include_tests:
    type: boolean
    required: false
    default: true
    description: "Whether to include test tasks for every new service and page"
```

## Output Schema

```yaml
output:
  sprint_summary:
    type: object
    properties:
      sprint_number:
        type: string
      title:
        type: string
      total_tasks:
        type: integer
      size_breakdown:
        type: object
        properties:
          small: { type: integer }
          medium: { type: integer }
          large: { type: integer }
  task_table:
    type: array
    items:
      type: object
      properties:
        task_number: { type: integer }
        description: { type: string }
        agent: { type: string }
        size: { type: enum, values: [S, M, L] }
        dependencies: { type: array, items: integer }
        files: { type: array, items: string }
        acceptance_criteria: { type: array, items: string }
  unmapped_criteria:
    type: array
    items: string
    description: "Any acceptance criteria that could not be mapped to tasks (should be empty)"
```

## Quality Gate

- Every acceptance criterion from the sprint spec maps to at least one task
- No task combines backend and frontend work in a single unit
- Dependency ordering follows shared types -> backend -> frontend -> tests -> docs
- Every task with new UI text includes a corresponding i18n task

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "sprint-decomposition"
  stage: "S2"
  suggested_next:
    - slug: "implementation-planning"
      stage: "S2"
      reason: "Decomposed tasks need detailed step-by-step implementation plans before execution"
    - slug: "agent-task-execution"
      stage: "S2"
      reason: "Task table is ready for agent dispatch and two-stage review execution"
```

## Error Handling

- If the sprint spec is missing acceptance criteria, halt decomposition and request spec completion before proceeding
- If a task maps to files that do not exist and are not created by a preceding task, flag as a dependency gap
- If an acceptance criterion is ambiguous and could map to multiple agents, assign a lead agent and note the ambiguity for human clarification
- If the task count exceeds 20, consider splitting into sub-sprints and flag for planning review
