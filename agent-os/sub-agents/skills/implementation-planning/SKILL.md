Title: Implementation Planning
Keywords: plan, implementation, task-breakdown, bite-sized, file-paths, code-plan, TDD-plan
Agents: planning, product
When to use: When you have sprint acceptance criteria or requirements and need to create a detailed, step-by-step implementation plan before writing code.
Version: 1.0.0
Last updated: 2026-03-18

Write comprehensive implementation plans assuming the implementing agent has zero codebase context. Document everything: which files to touch, exact code patterns, how to test, bite-sized steps (2-5 minutes each). Plans follow TDD: each task starts with a failing test. This skill complements `sprint-decomposition` — decomposition identifies WHAT tasks to do; this skill details HOW to do each task.

---

## When to Use

- After `sprint-decomposition` produces the task list
- When a task is complex enough to need step-by-step instructions
- When the implementing agent needs exact file paths, code snippets, and test commands
- Before handing off to `agent-task-execution` workflow

**Do not use for:**
- Simple single-file changes (direct agent dispatch is sufficient)
- Tasks already detailed in the sprint spec

---

## Workflow

### Step 1 — Scope Check

If the sprint covers multiple independent subsystems, each should get its own plan. Each plan should produce working, testable software on its own.

### Step 2 — Map File Structure

Before defining tasks, map out which files will be created or modified:

- Design units with clear boundaries and well-defined interfaces
- Each file should have one clear responsibility
- Follow established project patterns (see `memories/engineering-code-patterns.md`)
- In this codebase: follow the module checklist in CLAUDE.md

### Step 3 — Write Bite-Sized Steps

**Each step is one action (2-5 minutes):**

```markdown
### Task N: [Component Name]

**Files:**
- Create: the backend modules
- Modify: the backend (wire service + routes)
- Test: the backend

**Acceptance criteria:** [verbatim from sprint spec]

- [ ] **Step 1: Write the failing test**
  [Exact test code following test-patterns skill]

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run the backend
  Expected: FAIL with "function not defined" or similar

- [ ] **Step 3: Write minimal implementation**
  [Exact implementation code following service-pattern / component-pattern]

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run the backend
  Expected: PASS

- [ ] **Step 5: Commit**
  `git add <files> && git commit -m "feat(<module>): add <feature>"`
```

### Step 4 — Include Required Context

For each task, include:
- **Exact file paths** — never "create a service somewhere"
- **Complete code** — not "add validation" but the actual validation code
- **Exact test commands** with expected output
- **Build verification** — `npx tsc -p the shared packagetsconfig.json` etc.
- **Pattern references** — which skill to follow (service-pattern, component-pattern, etc.)

### Step 5 — Plan Review

After writing the plan:
1. Verify every acceptance criterion maps to at least one task
2. Verify file paths exist or will be created by preceding tasks
3. Verify dependency order (shared → backend → frontend)
4. Verify TDD steps are present for each task

---

## Plan Document Format

```markdown
# Sprint X.Y.Z — Implementation Plan

**Goal:** [One sentence]
**Architecture:** [2-3 sentences about approach]
**Build order:** shared → backend → frontend

---

### Task 1: [Title]
**Agent:** [backend | frontend | ...]
**Files:** [explicit paths]
**Depends on:** [task numbers or "none"]
**Acceptance criteria:** [which AC items]

[Bite-sized steps with code, tests, commands]

### Task 2: ...
```

---

## Key Principles

- **Exact file paths always** — implementing agents should never search for files
- **Complete code in plan** — not summaries or placeholders
- **TDD built-in** — every task starts with a failing test
- **DRY, YAGNI** — don't plan features beyond what's specified
- **Build verification** — each task includes build check after implementation
- **Frequent commits** — one commit per task minimum

---

## Anti-Patterns

- Vague instructions ("update the backend") instead of exact file paths
- Missing test steps — every task must include TDD cycle
- Skipping dependency order — shared types must precede backend/frontend
- Orphaned acceptance criteria — every AC must map to a task
- Over-planning — don't detail simple single-file changes

---

## Checklist

- [ ] Scope checked (single subsystem per plan)
- [ ] File structure mapped before task definition
- [ ] Every step is bite-sized (2-5 minutes, one action)
- [ ] Exact file paths for all creates/modifies
- [ ] Complete code included (not placeholders)
- [ ] TDD cycle in every task (test → fail → implement → pass → commit)
- [ ] Build verification included
- [ ] Every acceptance criterion maps to a task
- [ ] Dependency order respected (shared → backend → frontend)

---

## Related Skills

- `sprint-decomposition` — identifies tasks; this skill details them
- `task-routing` — assigns tasks to agents
- `agent-task-execution` — executes the plan this skill produces

## Input Schema

```yaml
input:
  sprint_spec_path:
    type: string
    required: true
    description: "Path to the sprint spec file (e.g., docs)"
  task_list:
    type: array
    items:
      type: object
      properties:
        task_number: { type: integer }
        description: { type: string }
        agent: { type: string }
        size: { type: enum, values: [S, M, L] }
        files: { type: array, items: string }
    required: true
    description: "Task table from sprint-decomposition to create detailed implementation plans for"
  plan_scope:
    type: enum
    values: [full-sprint, single-task]
    required: false
    default: full-sprint
    description: "Whether to plan the entire sprint or a single task"
```

## Output Schema

```yaml
output:
  implementation_plan:
    type: object
    properties:
      goal: { type: string }
      architecture_summary: { type: string }
      build_order: { type: string }
  task_plans:
    type: array
    items:
      type: object
      properties:
        task_number: { type: integer }
        title: { type: string }
        agent: { type: string }
        files: { type: array, items: string }
        depends_on: { type: array, items: integer }
        acceptance_criteria: { type: array, items: string }
        steps:
          type: array
          items:
            type: object
            properties:
              step_number: { type: integer }
              action: { type: string }
              code: { type: string }
              test_command: { type: string }
              expected_result: { type: string }
  unmapped_criteria:
    type: array
    items: string
    description: "Any acceptance criteria not covered by task plans (should be empty)"
```

## Quality Gate

- Every acceptance criterion from the sprint spec maps to at least one task plan step
- Every task plan includes TDD steps (failing test, implementation, passing test)
- All file paths are explicit and verified against the project structure
- Dependency order is respected (shared types -> backend -> frontend -> tests -> docs)

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "implementation-planning"
  stage: "S2"
  suggested_next:
    - slug: "agent-task-execution"
      stage: "S2"
      reason: "Detailed implementation plans are ready for sub-agent dispatch and execution"
    - slug: "tdd-discipline"
      stage: "S3"
      reason: "Implementation plans include TDD steps that must be followed during execution"
```

## Error Handling

- If the sprint spec is missing acceptance criteria or has ambiguous requirements, halt planning and request clarification before producing step-by-step plans
- If file paths referenced in task plans do not exist and are not created by a preceding step, flag the gap and adjust the plan to include the creation step
- If a task is too large (L-sized with 10+ steps), split into sub-tasks with their own TDD cycles and dependency ordering
- If the plan scope is single-task but the task has unmet dependencies, include the dependency context in the plan header and note what must be completed first
