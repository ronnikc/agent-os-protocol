Title: Agent Task Execution
Keywords: subagent, task-execution, two-stage-review, spec-compliance, code-quality, implementer, controller, orchestration, dispatch
Agents: planning, code-review
When to use: When executing sprint tasks via sub-agents — dispatch one agent per task with two-stage review (spec compliance then code quality) after each.
Version: 1.0.0
Last updated: 2026-03-18

Execute sprint tasks by dispatching a fresh sub-agent per task with precisely crafted context. After each task, run two-stage review: (1) spec compliance verification, (2) code quality review. The controller (orchestrator) never shares session history with sub-agents — it constructs exactly what they need. This preserves controller context and keeps sub-agents focused.

---

## Core Principle

Fresh sub-agent per task + two-stage review (spec then quality) = high quality, fast iteration.

---

## When to Use

- Sprint has multiple independent implementation tasks
- Tasks are decomposed by the Planning Specialist via `sprint-decomposition`
- Each task is scoped to a single agent
- You want automated quality gates between tasks

**Do not use when:**
- Tasks are tightly coupled and must share state
- A single small fix is needed (just dispatch the owning agent directly)

---

## Workflow

### Step 1 — Prepare Task Context

For each task from the sprint work plan:

1. Extract the full task description, acceptance criteria, and file list
2. Include architectural context (where this fits, dependencies on prior tasks)
3. Reference the relevant sprint spec section verbatim

**Never make sub-agents read the full sprint spec.** Provide the relevant text directly in the prompt.

### Step 2 — Dispatch Implementer Sub-Agent

Use the standard agent prompt template from `SUB-AGENTS.md` with these additions:

```
## Task
[FULL TEXT of task — paste it, don't reference files]

## Context
[Where this fits in the sprint, what was built before, dependencies]

## Before You Begin
If you have questions about requirements, approach, or dependencies — ask them now.
Raise concerns before starting work.

## Your Job
1. Implement exactly what the task specifies
2. Write tests (following test-patterns skill)
3. Verify implementation works (tsc + vitest)
4. Commit your work
5. Self-review: completeness, quality, discipline, testing
6. Report back with status

## Report Format
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- What you tested and test results
- Files changed
- Self-review findings
- Any issues or concerns
```

### Step 3 — Handle Implementer Status

| Status | Action |
|--------|--------|
| **DONE** | Proceed to spec compliance review (Step 4) |
| **DONE_WITH_CONCERNS** | Read concerns. If correctness/scope issue → address before review. If observation → note and proceed to review |
| **NEEDS_CONTEXT** | Provide missing context, re-dispatch same agent |
| **BLOCKED** | Assess: context problem → provide more context; task too complex → break down; plan wrong → escalate to human |

**Never** ignore an escalation or force the same agent to retry without changes.

### Step 4 — Spec Compliance Review

Dispatch a reviewer sub-agent to verify the implementer built what was requested:

```
You are reviewing whether an implementation matches its specification.

## What Was Requested
[FULL TEXT of task requirements]

## What Implementer Claims They Built
[From implementer's report]

## CRITICAL: Verify Independently
Read the actual code. Compare to requirements line by line.

Check for:
- Missing requirements (skipped, claimed but not implemented)
- Extra/unneeded work (over-engineering, unrequested features)
- Misunderstandings (wrong interpretation, wrong problem solved)

Report:
- ✅ Spec compliant (after code inspection)
- ❌ Issues found: [list what's missing or extra, with file:line references]
```

**If issues found:** Implementer sub-agent fixes them → re-run spec review → repeat until approved.

### Step 5 — Code Quality Review

**Only after spec compliance passes.** Dispatch the Code Review Specialist:

- Provide: what was implemented, task requirements, BASE_SHA, HEAD_SHA
- Reviewer checks: pattern compliance, RBAC, audit events, i18n, mock fidelity, error handling
- Uses standard Code Review Specialist handoff format

**If issues found:** Implementer fixes → re-review → repeat until approved.

### Step 6 — Mark Task Complete

Only after both reviews pass:
1. Mark task complete in sprint tracking
2. Move to next task

### Step 7 — Final Review

After ALL tasks complete, dispatch one final Code Review Specialist review across the entire sprint implementation to catch cross-task issues.

---

## Model Selection Guidance

Use the least powerful model that can handle each role:

| Task Complexity | Model Tier | Signals |
|----------------|------------|---------|
| Mechanical implementation (1-2 files, clear spec) | Fast/cheap | Isolated function, complete spec, no judgment |
| Integration tasks (multi-file, pattern matching) | Standard | Cross-file coordination, existing pattern following |
| Architecture, design, review | Most capable | Design judgment, broad codebase understanding |

---

## Anti-Patterns (NEVER DO)

1. **Skip reviews** — both stages are mandatory (spec compliance AND code quality)
2. **Start code quality review before spec compliance** — wrong order; fix spec issues first
3. **Dispatch multiple implementers in parallel** — they'll conflict on shared files
4. **Make sub-agent read sprint spec file** — provide full text in prompt instead
5. **Skip scene-setting context** — sub-agent needs to understand where task fits
6. **Ignore sub-agent questions** — answer before letting them proceed
7. **Accept "close enough"** — spec reviewer found issues = not done
8. **Skip re-review after fixes** — reviewer found issues → implementer fixes → review again
9. **Move to next task with open issues** — both reviews must pass first
10. **Let self-review replace actual review** — both are needed

---

## Checklist

- [ ] Task context extracted with full text (not file references)
- [ ] Implementer sub-agent dispatched with proper prompt template
- [ ] Implementer status handled correctly (DONE/CONCERNS/BLOCKED/NEEDS_CONTEXT)
- [ ] Spec compliance review passed
- [ ] Code quality review passed (only after spec compliance)
- [ ] Task marked complete only after both reviews pass
- [ ] Final cross-sprint review dispatched after all tasks

---

## Related Skills

- `sprint-decomposition` — produces the tasks this skill executes
- `task-routing` — determines which agent handles each task
- `pattern-compliance` — used by code quality reviewer
- `test-patterns` — referenced by implementer for test writing

## Input Schema

```yaml
input:
  task_list:
    type: array
    items:
      type: object
      properties:
        task_number: { type: integer }
        description: { type: string }
        agent: { type: string }
        files: { type: array, items: string }
        acceptance_criteria: { type: array, items: string }
        dependencies: { type: array, items: integer }
    required: true
    description: "Ordered list of sprint tasks from sprint-decomposition, each with agent assignment, file paths, and acceptance criteria"
  sprint_spec_excerpt:
    type: string
    required: true
    description: "Relevant sprint spec text to embed in sub-agent prompts (not a file path — the actual text)"
  model_tier_override:
    type: enum
    values: [fast, standard, capable]
    required: false
    description: "Override automatic model selection for implementer sub-agents"
```

## Output Schema

```yaml
output:
  task_results:
    type: array
    items:
      type: object
      properties:
        task_number: { type: integer }
        status: { type: enum, values: [DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT] }
        files_changed: { type: array, items: string }
        spec_review_passed: { type: boolean }
        quality_review_passed: { type: boolean }
        concerns: { type: array, items: string }
  final_review:
    type: object
    description: "Cross-sprint review results from the final Code Review Specialist pass"
    properties:
      passed: { type: boolean }
      findings: { type: array, items: string }
```

## Quality Gate

- Every task has passed both spec compliance review and code quality review before being marked complete
- No task was moved to the next without resolving all Blocker and Critical findings
- Final cross-sprint review completed with no unresolved issues
- All implementer sub-agents reported DONE or DONE_WITH_CONCERNS (no unresolved BLOCKED tasks)

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "agent-task-execution"
  stage: "S2"
  suggested_next:
    - slug: "pattern-compliance"
      stage: "S3"
      reason: "After all tasks are executed, a full pattern compliance review ensures no cross-task regressions"
    - slug: "tdd-discipline"
      stage: "S3"
      reason: "Verify that all implemented tasks followed the TDD red-green-refactor cycle"
```

## Error Handling

- If an implementer sub-agent returns BLOCKED, assess whether the block is a context gap (provide more context and re-dispatch) or a plan error (escalate to human for re-planning)
- If spec compliance review fails more than twice for the same task, escalate to human — the task specification may be ambiguous or incomplete
- If a sub-agent produces changes that break other tests, revert the changes, add the failing tests to the task context, and re-dispatch
- If the final cross-sprint review reveals cross-task integration issues, create follow-up fix tasks and run them through the same two-stage review process
