Title: Review Request
Keywords: code-review, dispatch, review-template, SHA, diff, quality-gate, severity
Agents: planning, backend, frontend, api
When to use: When completing a task, implementing a major feature, or before merging — to dispatch a structured code review with git SHAs and severity classification.
Version: 1.0.0
Last updated: 2026-03-18

Dispatch the Code Review Specialist with structured context: git SHAs for diff, what was built, what it should do, and severity-based response handling. Review early, review often — catch issues before they cascade.

---

## When to Request Review

**Mandatory:**
- After each task in `agent-task-execution` workflow
- After completing a major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

---

## Workflow

### Step 1 — Get Git SHAs

```bash
BASE_SHA=$(git rev-parse HEAD~1)  # or the commit before the task started
HEAD_SHA=$(git rev-parse HEAD)
```

For multi-commit tasks, use the commit before the first task commit as BASE_SHA.

### Step 2 — Dispatch Code Review Specialist

Build the agent prompt with these required fields:

```
You are the Code Review Specialist for Agent OS Protocol.

## Review Context

**What was implemented:** [Summary of what was built]
**Requirements source:** [Sprint spec section or task description]
**Base SHA:** [commit before changes]
**Head SHA:** [current commit]
**Description:** [Brief summary of the change]

## Before starting (MANDATORY)
1. Read your definition: sub-agents/agents/code-review.md
2. Read memories/engineering-code-patterns.md
3. Run: git diff {BASE_SHA}..{HEAD_SHA} --stat
4. Read each changed file

## Task
Review the diff between BASE_SHA and HEAD_SHA against the requirements.
Follow your standard review checklist.
Return results in your standard handoff format.
```

### Step 3 — Act on Feedback

| Severity | Action |
|----------|--------|
| **Critical** | Fix immediately — blocks all further work |
| **Major** | Fix before proceeding to next task |
| **Minor** | Note for later — can proceed |
| **Suggestion** | Evaluate — implement if valuable, skip if YAGNI |

When acting on feedback, use the `review-reception` skill.

---

## Integration with Workflows

| Workflow | Review Cadence |
|----------|---------------|
| `agent-task-execution` | Review after EACH task (two-stage: spec + quality) |
| Sprint implementation | Review after each major task group |
| Ad-hoc development | Review before merge |

---

## Anti-Patterns

- Do not skip review because "it's simple" — simple changes break things
- Do not ignore Critical issues — they block everything
- Do not proceed with unfixed Major issues
- Do not combine multiple tasks into one review — review each separately
- Do not review without git SHAs — the reviewer needs a clear diff boundary

---

## Checklist

- [ ] BASE_SHA and HEAD_SHA identified correctly
- [ ] Review request includes what was built and requirements source
- [ ] Code Review Specialist dispatched with proper prompt template
- [ ] Critical and Major issues fixed before proceeding
- [ ] Fixes verified (not just applied)

## Input Schema

```yaml
input:
  base_sha:
    type: string
    required: true
    description: "Git SHA of the commit before changes began"
  head_sha:
    type: string
    required: true
    description: "Git SHA of the current commit (latest change)"
  what_was_implemented:
    type: string
    required: true
    description: "Summary of what was built or changed"
  requirements_source:
    type: string
    required: true
    description: "Sprint spec section or task description the work fulfills"
```

## Output Schema

```yaml
output:
  review_dispatch:
    type: object
    description: "Structured review dispatch and feedback response"
    properties:
      review_requested:
        type: boolean
      reviewer_agent:
        type: string
      findings:
        type: array
        items:
          type: object
          properties:
            severity: "critical | major | minor | suggestion"
            description: string
            file: string
            resolved: boolean
      blocking_issues_remaining:
        type: integer
      status:
        type: "clean | fixes-needed | blocked"
```

## Quality Gate

- BASE_SHA and HEAD_SHA are valid git commits with a meaningful diff between them.
- Review dispatch includes all required context fields (what was built, requirements source, SHAs).
- All Critical and Major severity findings are resolved before proceeding to the next task.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "review-request"
  stage: "S2"
  suggested_next:
    - slug: "review-reception"
      stage: "S3"
      reason: "Process and act on the feedback returned by the code review"
    - slug: "verification-gate"
      stage: "S3"
      reason: "Verify that all review fixes pass tests and build"
```

## Error Handling

- If git SHAs cannot be resolved (detached HEAD, missing commits), fall back to `git log` to identify the correct commit range and report the discrepancy.
- If the Code Review Specialist agent fails to respond or crashes, retry once; if it fails again, escalate to the orchestrator with the review context attached.
- If the diff between BASE_SHA and HEAD_SHA is empty, abort the review request and notify the caller that no changes were detected.
