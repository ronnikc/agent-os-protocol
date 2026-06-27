Title: Review Reception
Keywords: code-review, feedback, receiving-review, pushback, verification, YAGNI, technical-evaluation
Agents: backend, frontend, api, test, build-integrity, compliance, security, i18n, accessibility, infrastructure
When to use: When receiving code review feedback from the orchestrator, other agents, or external reviewers — before implementing any suggestions.
Version: 1.0.0
Last updated: 2026-03-18

Code review requires technical evaluation, not performative agreement. Verify suggestions against the codebase before implementing. Push back with technical reasoning when feedback is incorrect. Clarify ALL unclear items before implementing ANY.

---

## Core Principle

**Verify before implementing. Ask before assuming. Technical correctness over social comfort.**

---

## Response Pattern

```
WHEN receiving code review feedback:

1. READ: Complete feedback without reacting
2. UNDERSTAND: Restate requirement in own words (or ask)
3. VERIFY: Check against codebase reality
4. EVALUATE: Technically sound for THIS codebase?
5. RESPOND: Technical acknowledgment or reasoned pushback
6. IMPLEMENT: One item at a time, test each
```

---

## Handling Unclear Feedback

```
IF any item is unclear:
  STOP — do not implement anything yet
  ASK for clarification on unclear items

Items may be related. Partial understanding = wrong implementation.
```

**Example:**
```
Orchestrator: "Fix items 1-6"
You understand 1,2,3,6. Unclear on 4,5.

❌ WRONG: Implement 1,2,3,6 now, ask about 4,5 later
✅ RIGHT: "Understand 1,2,3,6. Need clarification on 4,5 before implementing."
```

---

## Source-Specific Handling

### From Orchestrator / Lead Agent
- Trusted — implement after understanding
- Still ask if scope unclear
- Skip to action or technical acknowledgment

### From Reviewer Agents
```
BEFORE implementing:
  1. Check: Technically correct for THIS codebase?
  2. Check: Breaks existing functionality?
  3. Check: Reason for current implementation?
  4. Check: Does reviewer understand full context?

IF suggestion seems wrong:
  Push back with technical reasoning

IF can't easily verify:
  Say so: "Cannot verify without [X]. Should I investigate or proceed?"

IF conflicts with existing architectural decisions:
  Stop and escalate to orchestrator
```

### From External Reviewers (PR reviews, GitHub comments)
- Apply same verification steps as reviewer agents
- Be more skeptical — external reviewers lack project context
- Cross-reference against `docs/engineering/README.md` and `memories/engineering-code-patterns.md`

---

## YAGNI Check for Suggested Features

```
IF reviewer suggests "implementing properly" or adding features:
  Grep codebase for actual usage

  IF unused: Flag as YAGNI — "This endpoint/feature isn't called. Remove it?"
  IF used: Then implement properly
```

---

## Implementation Order

```
FOR multi-item feedback:
  1. Clarify anything unclear FIRST
  2. Then implement in this order:
     - Blocking issues (breaks, security)
     - Simple fixes (typos, imports)
     - Complex fixes (refactoring, logic)
  3. Test each fix individually
  4. Verify no regressions
```

---

## When to Push Back

Push back when:
- Suggestion breaks existing functionality
- Reviewer lacks full context
- Violates YAGNI (unused feature suggestion)
- Technically incorrect for this stack
- Conflicts with architectural decisions in `docs/engineering/README.md`
- Contradicts patterns in `memories/engineering-code-patterns.md`

**How to push back:**
- Use technical reasoning, not defensiveness
- Reference working tests or code
- Ask specific questions
- Escalate to orchestrator if architectural

---

## Acknowledging Correct Feedback

When feedback IS correct:
```
✅ "Fixed. [Brief description of what changed]"
✅ "Good catch — [specific issue]. Fixed in [location]."
✅ [Just fix it and show in the diff]

❌ "You're absolutely right!"
❌ "Great point!"
❌ "Thanks for catching that!"
```

Actions speak. Just fix it. The code shows you heard the feedback.

---

## Checklist

- [ ] All feedback items read completely before acting
- [ ] Unclear items identified and clarification requested
- [ ] Each suggestion verified against codebase before implementing
- [ ] YAGNI check performed for feature additions
- [ ] Implemented in priority order (blocking → simple → complex)
- [ ] Each fix tested individually
- [ ] No regressions introduced
- [ ] Pushed back with reasoning on incorrect suggestions

## Input Schema

```yaml
input:
  feedback_items:
    type: array
    items: string
    required: true
    description: "List of code review feedback items to process"
  feedback_source:
    type: string
    required: true
    enum: ["orchestrator", "reviewer-agent", "external"]
    description: "Source of the code review feedback"
  affected_files:
    type: array
    items: string
    required: false
    description: "File paths referenced in the review feedback"
```

## Output Schema

```yaml
output:
  review_response:
    type: object
    description: "Structured response to code review feedback"
    properties:
      items_received:
        type: integer
      clarifications_needed:
        type: array
        items: string
      items_accepted:
        type: array
        items:
          type: object
          properties:
            item: string
            fix_description: string
            tested: boolean
      items_pushed_back:
        type: array
        items:
          type: object
          properties:
            item: string
            reasoning: string
      regressions_found:
        type: boolean
      status:
        type: "complete | clarification-needed | in-progress"
```

## Quality Gate

- All feedback items have been read and categorized before any implementation begins.
- Unclear items have been identified and clarification requested before implementing any fixes.
- Each accepted fix has been tested individually with no regressions introduced.
- YAGNI check performed for any suggested feature additions.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "review-reception"
  stage: "S3"
  suggested_next:
    - slug: "verification-gate"
      stage: "S3"
      reason: "Verify all review fixes pass tests and build before claiming completion"
    - slug: "review-request"
      stage: "S2"
      reason: "Request a follow-up review if significant changes were made during fix implementation"
```

## Error Handling

- If feedback items reference files or code that no longer exists in the current branch, flag the discrepancy and ask the reviewer for updated context.
- If a suggested fix introduces a regression in existing tests, revert the fix and report the conflict to the reviewer with test evidence.
- If feedback conflicts with architectural decisions documented in engineering docs, escalate to the orchestrator rather than implementing or rejecting unilaterally.
