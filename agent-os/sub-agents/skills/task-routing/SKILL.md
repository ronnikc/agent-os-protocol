Title: Task Routing
Keywords: task-routing, agent, delegation, sub-agent, prompt, parallelism
Agents: planning
When to use: When routing decomposed tasks to specialist agents with proper context and file paths.
Version: 1.0.0
Last updated: 2026-03-18

Route tasks to the correct specialist agent with proper context. Match by owned source directory, include explicit file paths, identify cross-cutting concerns, specify expected output format, and respect parallelism limits.

---

## Workflow

### Step 1 — Match Task to Agent

Use the source directory to determine the owning agent:

| Source directory | Agent |
|-----------------|-------|
| `src/shared/` | Backend (shared types are backend-owned) |
| `src/backend/` | Backend |
| `src/frontend/` | Frontend |
| `docs/compliance/` | Compliance |
| `docs/security/` | Security |
| Project root (Docker, CI) | Infrastructure |

### Step 2 — Build the Agent Prompt

Every agent prompt must include:

```
You are the [AGENT NAME] agent for the Agent OS Protocol.

Focus area: [FOCUS]
Owned docs: [LIST]
Owned source: [LIST]

Before writing code:
1. Read docs/engineering/README.md
2. Read your owned specs listed above
3. Check docs/reference/id-conventions.md and docs/reference/json-schemas.md
4. Check docs/security/permission-matrix.md for RBAC implications

Task: [SPECIFIC TASK DESCRIPTION]
Sprint: [SPRINT NUMBER]
Acceptance criteria: [VERBATIM FROM SPRINT FILE]

Files to create or modify:
- [EXPLICIT FILE PATH 1]
- [EXPLICIT FILE PATH 2]

Expected output:
- [WHAT THE AGENT SHOULD PRODUCE]
```

### Step 3 — Include Explicit File Paths

Never ask an agent to "explore" or "find" files. Provide exact paths:

- **Good:** "Create `src/backend/src/modules/tasks/task-service.ts`"
- **Bad:** "Create a task service somewhere in the backend"

### Step 4 — Identify Cross-Cutting Concerns

When a task touches multiple agents' domains, designate a lead and reviewer:

| Combination | Lead | Reviewer | Review focus |
|------------|------|----------|--------------|
| Backend + Security | Backend | Security | RBAC, data classification |
| Frontend + Security | Frontend | Security | Auth flows, sensitive fields |
| Backend + Compliance | Backend | Compliance | Audit events, legal timelines |
| Infrastructure + Security | Infrastructure | Security | Deployment hardening |

### Step 5 — Specify Expected Output Format

Tell agents exactly what to produce:

- **Code tasks:** "Create the file with the complete implementation. Do not leave TODO comments."
- **Seed tasks:** "Add entries to the existing array. Field names must match the frontend rendering."
- **Test tasks:** "Create a test file with at least one test per public method. Use existing mock factories."
- **i18n tasks:** "Add keys to all 16 locale files. Use the exact key path specified."

### Step 6 — Respect Parallelism Limits

- **Max 4 parallel agents** on large tasks (L-sized) (raised from 2 in Sprint 18.5.0)
- **Max 4 parallel agents** on small tasks (S-sized)
- Documentation-heavy sprints: prefer sequential execution
- Never delegate files > 800 lines to sub-agents via the Write tool

### Routing Decision Tree

```
Is the task a single-focus task?
  YES → Route to owning agent
  NO  → Is it cross-cutting?
    YES → Assign lead agent + reviewer
         → Lead implements, reviewer checks their domain
    NO  → Is it a sprint implementation?
         YES → Use Product agent to decompose first
         NO  → Route to most relevant agent
```

### Step 7 — Parallel Dispatch Decision

When multiple tasks are ready for execution, determine whether to parallelize:

```
Are the tasks independent?
  NO (related/shared state) → Execute sequentially
  YES → Can agents work without conflicting?
    NO (same files, shared resources) → Execute sequentially
    YES → Dispatch in parallel (respect max 4 agent limit)
```

**Dispatch in parallel when:**
- 2+ tasks touch different modules/files with no shared state
- Each task can be understood without context from others
- Agents won't edit the same files

**Dispatch sequentially when:**
- Fixing one task might fix others (related failures)
- Tasks share files or state
- Need to understand full system state first
- Dependencies exist between tasks (shared → backend → frontend)

**Parallel agent prompt structure:**
- **Focused** — one clear problem domain per agent
- **Self-contained** — all context needed to understand the problem (don't inherit session history)
- **Specific about output** — what should the agent return?
- **Constrained** — "Do NOT change files outside your scope"

### Anti-Patterns

- Do not route a backend task to the frontend agent "because it's small"
- Do not combine two agents' work into one prompt
- Do not let agents explore the codebase — provide file paths
- Do not spawn 3+ agents simultaneously on large file creation
- Do not parallelize tasks that touch the same files
- Do not dispatch parallel agents with vague scope ("fix all the tests")
- Do not skip integration verification after parallel agents return

## Input Schema

```yaml
input:
  tasks:
    type: array
    items:
      type: object
      properties:
        description:
          type: string
        files:
          type: array
          items:
            type: string
        sprint:
          type: string
    required: true
    description: "List of decomposed tasks with descriptions, file paths, and sprint context"
  parallelism_preference:
    type: enum[parallel, sequential, auto]
    required: false
    default: "auto"
    description: "Whether to prefer parallel or sequential dispatch, or let the router decide"
```

## Output Schema

```yaml
output:
  routing_plan:
    type: array
    items:
      task:
        type: string
        description: "Task description"
      agent:
        type: string
        description: "Assigned agent name"
      role:
        type: enum[lead, reviewer]
        description: "Agent's role for this task"
      files:
        type: array
        description: "Explicit file paths for the agent"
      dispatch_order:
        type: number
        description: "Execution order (tasks with same number run in parallel)"
  cross_cutting_concerns:
    type: array
    description: "Tasks that span multiple agents' domains with lead/reviewer assignments"
  parallelism_plan:
    type: string
    description: "Explanation of parallel vs sequential dispatch decisions"
```

## Quality Gate

- Every task is assigned to exactly one lead agent with explicit file paths — no unrouted tasks.
- Cross-cutting concerns have both a lead and a reviewer agent assigned.
- Parallelism limits are respected (max 4 agents on large tasks, max 4 on small tasks).
- No two parallel tasks touch the same files.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "task-routing"
  stage: "S1"
  suggested_next:
    - slug: "codebase-exploration"
      stage: "S1"
      reason: "Agents may need to explore the codebase before implementing routed tasks"
    - slug: "impact-analysis"
      stage: "S1"
      reason: "Verify blast radius of routed tasks before agents begin implementation"
```

## Error Handling

- If a task cannot be matched to a single agent (ambiguous ownership), escalate to the planning agent for manual assignment.
- If file paths are missing from the task description, invoke the codebase-exploration skill to resolve them before routing.
- If parallelism limits would be exceeded, queue excess tasks for sequential dispatch after the first batch completes.
- If cross-cutting concerns are detected but no reviewer is available, flag the task as requiring manual review post-implementation.
