Title: Code Review and Quality
Keywords: code-review, five-axis, severity-labels, change-sizing, review-rubric, dead-code, dependency-discipline, multi-model-review
Agents: code-review, planning, backend, frontend, api
When to use: Before merging any change. After completing a feature implementation. When evaluating code produced by another agent or human. After any bug fix (review both fix and regression test). Pairs with `pattern-compliance` (project-specific patterns) — this skill provides the multi-axis quality rubric on top.
Version: 1.0.0
Last updated: 2026-04-27

Five-axis review rubric: correctness, readability, architecture, security, performance. Includes change sizing (~100 lines), severity labels (Critical / required / Nit / Optional / FYI), splitting strategies, and review-speed norms. Provides the structured rubric that complements the existing `review-request` / `review-reception` protocol skills. Adapted from [addyosmani/agent-skills code-review-and-quality](https://github.com/addyosmani/agent-skills/blob/main/skills/code-review-and-quality/SKILL.md).

---

## The Approval Standard

> **Approve a change when it definitely improves overall code health, even if it isn't perfect.**

Perfect code doesn't exist — the goal is continuous improvement. Don't block a change because it isn't exactly how you would have written it. If it improves the codebase and follows project conventions (`pattern-compliance`), approve it.

That said: don't accept "I'll clean it up later." Experience in this codebase shows deferred cleanup rarely happens. Require fixes before merge unless it's a genuine emergency, in which case file a follow-up task with explicit owner.

---

## The Five-Axis Review

Every review evaluates code across these dimensions:

### 1. Correctness

Does the code do what it claims to do?

- Matches the sprint task spec or acceptance criteria?
- Edge cases handled (null, empty, boundary, MongoDB ObjectId casts)?
- Error paths handled — `AppError(status, code, message)` with correct args?
- Tests cover behavior, not implementation details?
- Off-by-one, race conditions, multi-tenant data leaks?

### 2. Readability & Simplicity

Can another engineer or agent understand this without explanation?

- Names descriptive and consistent with project conventions (no `temp`, `data`, `result` without context)
- Control flow straightforward — no nested ternaries, no deep callbacks
- **Could this be done in fewer lines?** (1000 lines where 100 suffice is a failure — see `code-simplification`)
- **Are abstractions earning their complexity?** Don't generalize until the third use case
- No dead code: no-op variables (`_unused`), backwards-compat shims, `// removed` comments

### 3. Architecture

Does the change fit the system's design?

- Follows existing patterns (`service-pattern`, `component-pattern`, `api-contract-validation`)?
- New patterns introduced are justified and discussed?
- Module boundaries respected — no crossing of `src/backend` ↔ `src/frontend` except through `src/shared`?
- Dependencies flow correctly — no circular imports?
- Abstraction level appropriate — not over-engineered, not too coupled?

### 4. Security

For the full security rubric, see `security-and-hardening`. Quick checks for any reviewer:

- User input validated with Zod at the route boundary
- No secrets in code
- Auth: `authenticate` + `enforceOrgScope` + `requirePermission` on every protected route
- No raw input in MongoDB filters
- No `dangerouslySetInnerHTML` with user data
- External data treated as untrusted before use

### 5. Performance

For the full perf rubric, see `performance-optimization`. Quick checks:

- No N+1 query patterns (loops calling `findById`)
- No unbounded loops or unconstrained data fetching
- Pagination on every list endpoint
- No unnecessary re-renders in React (stable refs, memoization where measured needed)
- Heavy computation off the main thread / event loop

---

## Change Sizing

Small, focused changes are easier to review, faster to merge, and safer to deploy.

```
~100 lines changed   → Good. Reviewable in one sitting.
~300 lines changed   → Acceptable if it's a single logical change.
~1000 lines changed  → Too large. Split it.
```

**One change = one self-contained modification, one concern, with related tests, leaving the system functional.** One slice of a feature — not the whole feature. (See `incremental-implementation`.)

**Splitting strategies when too large:**

| Strategy | How | When |
|----------|-----|------|
| **Stack** | Submit a small change, base the next one on it | Sequential dependencies |
| **By file group** | Separate changes for groups needing different reviewers | Cross-cutting (e.g., backend + i18n) |
| **Horizontal** | Shared types/stubs first, then consumers | Layered architecture |
| **Vertical** | Smaller full-stack slices | Feature work — see `incremental-implementation` |

**When large changes are acceptable:** complete file deletions and automated refactoring (codemods) where the reviewer verifies intent, not every line.

**Separate refactoring from feature work** — submit them as different PRs. Small renames can be included at reviewer discretion.

---

## Severity Labels (MANDATORY)

Label every comment so the author knows what's required vs optional. This is the most important behavior change for agent-driven review.

| Prefix | Meaning | Author Action |
|--------|---------|---------------|
| **Blocker:** | Multi-tenant data leak, missing auth, broken functionality, security hole | Must fix — merge blocked |
| **Critical:** | Wrong field names, missing audit events, data integrity issue | Must fix before merge |
| *(no prefix)* | Required change | Must address before merge |
| **Nit:** | Minor, optional | Author may ignore — formatting, style preferences |
| **Optional:** / **Consider:** | Suggestion | Worth considering, not required |
| **FYI:** | Informational only | No action needed — context for future reference |

The existing project severity scale (`pattern-compliance`) maps cleanly: Blocker, Critical, Major (= unprefixed required), Minor (= Nit). Use whichever vocabulary the team prefers — the point is **every comment has a severity**.

---

## Review Process

### Step 1 — Understand the Context

Before looking at code:

```
- What sprint task does this implement?
- What's the spec / acceptance criteria?
- What's the expected behavior change?
```

Read the sprint spec, not just the diff.

### Step 2 — Review Tests First

Tests reveal intent and coverage:

- Do tests exist for the change?
- Do they test behavior, not implementation details?
- Are edge cases covered?
- Test names descriptive?
- Would tests catch a regression if the code changed?

If the answer to any of these is "no," that's a Critical finding before reading the implementation.

### Step 3 — Walk the Diff

For each file, run the five axes mentally:

```
1. Correctness: Does this code do what the test says it should?
2. Readability: Can I understand this without help?
3. Architecture: Does this fit the system?
4. Security: Any vulnerabilities?
5. Performance: Any bottlenecks?
```

### Step 4 — Categorize Findings

Every comment gets a severity prefix from the table above. No exceptions — unprefixed comments are noise.

### Step 5 — Verify the Verification

Check the author's evidence:

- Which `tsc` and `vitest` commands ran?
- Was the change tested manually for UI work?
- Screenshots or before/after for UI changes?
- Did the agent run the FULL frontend suite or only individual files? (Incident 15 — full suite is mandatory.)

If verification evidence is missing, that's a Blocker — request it before continuing review.

---

## Multi-Model / Multi-Agent Review

Different agents catch different issues. The codebase already uses two-stage review (`agent-task-execution`) — extend with multi-model where stakes are high:

```
Backend agent writes the code
    │
    ▼
Code Review Specialist runs five-axis review
    │
    ▼
Backend agent addresses feedback
    │
    ▼
Security Specialist reviews if security surface touched
    │
    ▼
Human approval for merge
```

---

## Dead Code Hygiene

After any refactor or feature change, check for orphaned code:

1. Identify code that is now unreachable or unused (use `graph-navigator` for blast radius)
2. List it explicitly in the review
3. **Ask before deleting:** "Should I remove these now-unused elements: [list]?"

Don't silently delete things you're not sure about. Don't leave dead code lying around either.

```
DEAD CODE IDENTIFIED:
- formatLegacyDate() in src/shared/src/utils/date.ts — replaced by formatDate()
- OldRiskCard component in src/frontend/src/components — replaced by RiskCard
- LEGACY_API_URL in src/shared/src/config — no remaining references (verified via graph-navigator)
→ Safe to remove these?
```

---

## Review Speed

Slow reviews block agents and humans alike. Cost of context-switching to review < cost of others waiting.

- **Respond within one business day** — maximum, not target
- **Ideal:** respond shortly after a request arrives, unless mid-focused-work
- **Prioritize fast individual responses** over quick final approval — quick feedback reduces cycle time even with multiple rounds
- **Large changes:** ask the author to split rather than reviewing one massive changeset

---

## Handling Disagreements

When resolving review disputes, apply this hierarchy:

1. **Technical facts and data** override opinions and preferences
2. **Style guides + `pattern-compliance`** are absolute on style/pattern matters
3. **Software design** evaluated on engineering principles, not personal taste
4. **Codebase consistency** is acceptable if it doesn't degrade overall health

If the author has full context and disagrees on a non-Blocker, defer to their judgment. **Comment on code, not people** — reframe personal critiques to focus on the code itself.

---

## Honesty in Review

When reviewing code — yours, another agent's, or a human's:

- **Don't rubber-stamp.** "LGTM" without evidence helps no one.
- **Don't soften real issues.** "This might be a minor concern" when it's a bug heading to production is dishonest.
- **Quantify problems.** "This N+1 will add ~50ms per item" beats "this could be slow."
- **Push back on approaches with clear problems.** Sycophancy is a review failure mode.
- **Accept override gracefully** when the author has full context.

---

## Dependency Discipline

Part of review is dependency review:

**Before any new dependency:**
1. Does the existing stack solve this? (Often yes — Express + Mongo + React + Vitest cover most needs.)
2. How large is it? (Bundle impact for frontend, install size for backend.)
3. Actively maintained? (Last commit, open issues.)
4. Known vulnerabilities? (`npm audit`)
5. License compatible?

Prefer standard library and existing utilities over new dependencies. Every dependency is a liability.

---

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "It works, that's good enough" | Working code that's unreadable, insecure, or architecturally wrong creates compounding debt. |
| "I wrote it, so I know it's correct" | Authors are blind to their own assumptions. |
| "We'll clean it up later" | Later never comes. The review is the quality gate. |
| "AI-generated code is probably fine" | AI code needs more scrutiny, not less. It's confident and plausible even when wrong. |
| "The tests pass, so it's good" | Tests are necessary but not sufficient. They miss architecture, security, and readability issues. |

---

## Red Flags

- PRs merged without review
- Review that only checks tests passed (ignoring other axes)
- "LGTM" without evidence of actual review
- Security-sensitive changes without `security-and-hardening` review
- Large PRs that are "too big to review properly" — split them
- No regression tests with bug fix PRs
- Review comments without severity labels — author doesn't know what's required
- Accepting "I'll fix it later"
- Tests modified to make new code pass (behavior changed without acknowledgment)

---

## Input Schema

```yaml
input:
  changeset_ref:
    type: string
    required: true
    description: "Git ref or PR identifier under review (e.g., 'sha range', 'PR #1234', 'branch:feature-x')"
  sprint_task_id:
    type: string
    required: false
    description: "Sprint task ID this change implements — used to load spec for correctness check"
  axes_in_scope:
    type: array
    items:
      type: enum
      values: [correctness, readability, architecture, security, performance, all]
    required: false
    default: [all]
    description: "Limit review to specific axes if running a focused review"
  multi_agent_chain:
    type: array
    items: string
    required: false
    description: "Other specialist agents that should review after this one (e.g., security, accessibility)"
```

## Output Schema

```yaml
output:
  findings:
    type: array
    items:
      type: object
      properties:
        severity:
          type: enum
          values: [Blocker, Critical, Required, Nit, Optional, FYI]
        axis:
          type: enum
          values: [correctness, readability, architecture, security, performance]
        file: { type: string }
        line: { type: integer }
        description: { type: string }
        suggestion: { type: string }
  change_size:
    type: object
    properties:
      lines_added: { type: integer }
      lines_removed: { type: integer }
      net_lines: { type: integer }
      verdict:
        type: enum
        values: [good, acceptable, too-large-split-recommended]
      split_strategy_recommended: { type: string, description: "If too-large" }
  dead_code:
    type: array
    items: { type: object, properties: { path: string, reason: string } }
  verdict:
    type: enum
    values: [approve, request-changes, block]
  next_reviewers:
    type: array
    items: string
    description: "Agents queued for follow-up review (Security, Accessibility, etc.)"
```

## Quality Gate

- Every finding has an explicit severity label
- Zero Blocker findings unresolved at merge
- Zero Critical findings unresolved at merge
- Verification evidence (tsc + full vitest output) reviewed and judged sufficient
- Change size is `good` or `acceptable`, OR a split-strategy was applied
- Dead code identified is either deleted or has a follow-up task assigned
- For changes touching security surfaces, `security-and-hardening` review is queued
- For changes touching UI, `accessibility-audit` review is queued
- For changes touching i18n, `i18n-anti-pattern-detection` review is queued

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "code-review-and-quality"
  stage: "S3"
  suggested_next:
    - slug: "pattern-compliance"
      stage: "S3"
      reason: "Run project-specific pattern checks alongside the multi-axis rubric"
    - slug: "security-and-hardening"
      stage: "S3"
      reason: "Deeper security review for any change touching auth, input, or secrets"
    - slug: "performance-optimization"
      stage: "S3"
      reason: "Deeper perf review if any axis-5 finding surfaced"
    - slug: "review-reception"
      stage: "S3"
      reason: "Author handles findings; verify before implementing, push back when incorrect"
```

## Error Handling

- If verification evidence is missing or stale, refuse to review until fresh evidence is provided — don't paper over with "looks fine"
- If the change has no tests for new logic, file it as Critical and stop the review until tests exist
- If the changeset exceeds 1000 lines and is not pure deletion or codemod, refuse review and request a split
- If the agent cannot determine severity for a finding, default to the higher severity and let the author downgrade with justification
- If a finding crosses domains (e.g., security AND performance), file under both axes — don't pick the "primary" one
- If review reveals the underlying spec is wrong, route back to Planning Specialist before continuing
