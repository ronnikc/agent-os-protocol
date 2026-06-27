Title: Code Simplification
Keywords: simplification, refactoring, chesterton-fence, rule-of-500, clarity, cleanup, readability, complexity-reduction
Agents: code-review, backend, frontend, api
When to use: After a feature works and tests pass but the implementation feels heavier than it needs to be. During code review when readability or complexity is flagged. When consolidating duplicated logic or untangling deeply nested code. NOT for code you don't understand yet, NOT for performance-critical paths where a "simpler" version would be measurably slower.
Version: 1.0.0
Last updated: 2026-04-27

Reduce complexity while preserving exact behavior. The goal is not fewer lines — it's code easier to read, understand, modify, and debug. Every simplification must pass: "Would a new team member understand this faster than the original?" Adapted from [addyosmani/agent-skills code-simplification](https://github.com/addyosmani/agent-skills/blob/main/skills/code-simplification/SKILL.md), with the Claude Code Simplifier plugin as the original inspiration.

---

## The Five Principles

### 1. Preserve Behavior Exactly

Don't change what the code does — only how it expresses it. All inputs, outputs, side effects, error behavior, and edge cases must remain identical.

```
ASK BEFORE EVERY CHANGE:
→ Does this produce the same output for every input?
→ Does this maintain the same error behavior (AppError codes, status codes)?
→ Does this preserve the same audit events?
→ Do all existing tests still pass without modification?
```

If a simplification requires modifying tests to pass, you changed behavior — revert.

### 2. Follow Project Conventions

Simplification means more consistency with the codebase, not external preferences. Before simplifying, read:

- `CLAUDE.md` for repo conventions
- `agent-os/RULES.md` for non-negotiables
- `pattern-compliance` skill for project patterns (AppError shape, named imports, `.js` extensions, `useLocale`, CSS naming)
- Neighboring code for the local style

Simplification that breaks project consistency is not simplification — it's churn.

### 3. Prefer Clarity Over Cleverness

Explicit code is better than compact code when the compact version requires a mental pause to parse.

```typescript
// UNCLEAR: dense ternary chain
const label = isNew ? 'New' : isUpdated ? 'Updated' : isArchived ? 'Archived' : 'Active';

// CLEAR: readable mapping
function getStatusLabel(item: Item): string {
  if (item.isNew) return 'New';
  if (item.isUpdated) return 'Updated';
  if (item.isArchived) return 'Archived';
  return 'Active';
}
```

```typescript
// UNCLEAR: chained reduces with inline logic
const result = items.reduce((acc, item) => ({
  ...acc,
  [item.id]: { ...acc[item.id], count: (acc[item.id]?.count ?? 0) + 1 }
}), {});

// CLEAR: named intermediate step
const countById = new Map<string, number>();
for (const item of items) {
  countById.set(item.id, (countById.get(item.id) ?? 0) + 1);
}
```

### 4. Maintain Balance

Watch for over-simplification:

- **Inlining too aggressively** — removing a helper that gave a concept a name makes the call site harder to read
- **Combining unrelated logic** — two simple functions merged into one complex function is not simpler
- **Removing "unnecessary" abstraction** — some abstractions exist for testability or audit hooks, not complexity
- **Optimizing for line count** — fewer lines is not the goal; easier comprehension is

### 5. Scope to What Changed

Default to simplifying recently modified code. Avoid drive-by refactors of unrelated code unless explicitly asked. Unscoped simplification creates noisy diffs and risks unintended regressions — and **the Code Review Specialist will reject it**.

---

## The Simplification Process

### Step 1 — Understand Before Touching (Chesterton's Fence)

Before changing or removing anything, understand why it exists. If you see a fence across a road and don't understand why, don't tear it down. First understand the reason, then decide if the reason still applies.

```
BEFORE SIMPLIFYING, ANSWER:
- What is this code's responsibility?
- What calls it? What does it call?
- What are the edge cases and error paths?
- Are there tests that define the expected behavior?
- Why might it have been written this way? (RBAC requirement? Audit hook? Multi-tenancy? Historical reason?)
- Run `git blame` — what was the original sprint context?
```

**Project-specific Chesterton fences in this codebase:**

| Pattern that looks "weird" | Why it exists |
|---------------------------|---------------|
| `_id as unknown as string` | MongoDB ObjectId cast — Incident 14 |
| `requirePermission(...) as any` | Express middleware type compat — RBAC contract |
| `enforceOrgScope` middleware on every route | Multi-tenancy isolation — never remove |
| Service constructor takes `db` and `org_id` separately | Auditable scoped writes |
| `useLocale()` instead of inline strings | i18n contract — multiple locales |
| `auditLog()` calls in service methods | Compliance audit trail |
| `AppError(status, code, message)` | Three-arg form is required by error-handler middleware |

If you can't answer why the fence exists, you're not ready to simplify. Read more context first.

### Step 2 — Identify Simplification Opportunities

Scan for these concrete signals:

**Structural complexity:**

| Pattern | Signal | Simplification |
|---------|--------|----------------|
| Deep nesting (3+ levels) | Hard to follow control flow | Guard clauses or extracted helpers |
| Long functions (50+ lines) | Multiple responsibilities | Split by concern with descriptive names |
| Nested ternaries | Mental stack to parse | if/else chains, switch, lookup objects |
| Boolean parameter flags | `doThing(true, false, true)` | Options objects or separate functions |
| Repeated conditionals | Same `if` in multiple places | Extract to a well-named predicate |

**Naming and readability:**

| Pattern | Signal | Simplification |
|---------|--------|----------------|
| Generic names | `data`, `result`, `temp`, `val`, `item` | Rename to describe content: `userProfile`, `validationErrors` |
| Abbreviated names | `usr`, `cfg`, `btn`, `evt` | Full words unless the abbreviation is universal (`id`, `url`) |
| Misleading names | Function `get` that mutates state | Rename to reflect actual behavior |
| Comments restating "what" | `// increment counter` above `count++` | Delete |
| Comments explaining "why" | `// Retry because Mongo replica election can lag 200ms` | Keep — they carry intent |

**Redundancy:**

| Pattern | Signal | Simplification |
|---------|--------|----------------|
| Duplicated logic | Same 5+ lines in multiple places | Extract to shared function |
| Dead code | Unreachable branches, unused vars, commented-out blocks | Remove (after confirming truly dead — `graph-navigator` can verify) |
| Unnecessary abstractions | Wrapper that adds no value | Inline the wrapper |
| Over-engineered patterns | Factory-for-a-factory, strategy-with-one-strategy | Replace with the simple direct approach |
| Redundant type assertions | Casting to a type already inferred | Remove the assertion |

### Step 3 — Apply Changes Incrementally

Make one simplification at a time. Run tests after each change. **Submit refactoring changes separately from feature or bug fix changes.**

```
FOR EACH SIMPLIFICATION:
1. Make the change
2. Run the relevant test file: npx vitest run path/to/file.test.ts
3. Tests pass → commit (or continue to next)
4. Tests fail → revert and reconsider
```

After all simplifications in a batch, run the full frontend test suite (`cd the frontend && npx vitest run`) — incident 15 showed individual files mask cross-module regressions.

**The Rule of 500:** If a refactoring would touch more than 500 lines, invest in automation (codemods, sed scripts, AST transforms) rather than making the changes by hand. Manual edits at that scale are error-prone and exhausting to review.

### Step 4 — Verify the Result

After all simplifications, step back:

```
COMPARE BEFORE AND AFTER:
- Is the simplified version genuinely easier to understand?
- Did you introduce any new patterns inconsistent with neighboring code?
- Is the diff clean and reviewable (~100 lines)?
- Would a Code Review Specialist approve this change?
```

If the "simplified" version is harder to understand or review, revert.

---

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "It's working, no need to touch it" | Working code that's hard to read will be hard to fix when it breaks. |
| "Fewer lines is always simpler" | A 1-line nested ternary is not simpler than a 5-line if/else. Comprehension speed, not line count. |
| "I'll just quickly simplify this unrelated code too" | Unscoped simplification creates noisy diffs and risks regressions. Stay focused. |
| "The types make it self-documenting" | Types document structure, not intent. A well-named function explains *why* better. |
| "This abstraction might be useful later" | Don't preserve speculative abstractions. Remove and re-add when needed. |
| "The original author must have had a reason" | Maybe — `git blame`, apply Chesterton's Fence. But accumulated complexity often has no reason; it's just residue. |
| "I'll refactor while adding this feature" | Separate refactoring from feature work. Mixed changes are harder to review and revert. |

---

## Red Flags

- Simplification that requires modifying tests to pass — you changed behavior
- "Simplified" code that is longer and harder to follow than the original
- Renaming things to match your preferences rather than project conventions
- Removing error handling, audit calls, or RBAC checks because "it makes the code cleaner"
- Simplifying code you don't fully understand
- Batching many simplifications into one large, hard-to-review commit
- Refactoring code outside the scope of the current task without being asked

---

## Input Schema

```yaml
input:
  target_paths:
    type: array
    items: string
    required: true
    description: "Files or directories scoped for simplification"
  trigger:
    type: enum
    values: [post-feature, review-finding, scheduled-cleanup, user-request]
    required: true
    description: "What initiated the simplification pass — affects how strict scope discipline must be"
  preserve_tests_unchanged:
    type: boolean
    required: false
    default: true
    description: "If true (default), any change requiring a test update is rejected as behavior-altering"
  rule_of_500_threshold:
    type: integer
    required: false
    default: 500
    description: "Line threshold above which manual refactoring is rejected in favor of codemod/automation"
```

## Output Schema

```yaml
output:
  changes:
    type: array
    items:
      type: object
      properties:
        file: { type: string }
        before_lines: { type: integer }
        after_lines: { type: integer }
        category:
          type: enum
          values: [structural, naming, redundancy, dead-code, type-assertion]
        chesterton_check:
          type: object
          properties:
            asked: { type: boolean, description: "Did we investigate why the original existed?" }
            git_blame_consulted: { type: boolean }
            kept_safety_pattern: { type: boolean, description: "True if a project-specific 'weird-looking' pattern was preserved" }
        tests_run: { type: array, items: string }
        tests_passed: { type: boolean }
  rejected_simplifications:
    type: array
    items:
      type: object
      properties:
        location: { type: string }
        reason: { type: string, description: "Why the simplification was reverted (made code harder to read, removed safety pattern, exceeded scope, etc.)" }
  totals:
    type: object
    properties:
      net_lines_removed: { type: integer }
      files_modified: { type: integer }
      total_lines_touched: { type: integer, description: "Used to enforce Rule of 500" }
```

## Quality Gate

- All existing tests pass without modification (test-edits would mean behavior changed — revert that simplification)
- `tsc --noEmit` passes for every modified workspace
- Linter and Prettier pass — no style regressions
- Each simplification is a standalone reviewable commit
- The diff stays within scope — no unrelated drive-by changes
- Project-specific safety patterns preserved: AppError shape, RBAC checks, audit calls, `useLocale` usage, MongoDB casts
- No commented-out code or unused imports left behind
- Total lines touched ≤ Rule of 500; if exceeded, the work was done with a codemod or split into multiple PRs

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "code-simplification"
  stage: "S3"
  suggested_next:
    - slug: "code-review-and-quality"
      stage: "S3"
      reason: "After simplification, run a five-axis review to confirm clarity, architecture, and security weren't degraded"
    - slug: "pattern-compliance"
      stage: "S3"
      reason: "Verify project-specific patterns are still intact after simplification"
    - slug: "verification-gate"
      stage: "S3"
      reason: "Confirm fresh test/build evidence before merging the cleanup"
```

## Error Handling

- If a simplification requires modifying any existing test, revert it — that's a behavior change, not a simplification
- If `git blame` shows a "weird" pattern was introduced as a fix for a documented incident, do NOT simplify it — leave a comment linking the incident if one isn't already there
- If the simplification would exceed Rule of 500 lines, stop and either (a) write a codemod/sed script with explicit before/after examples, or (b) split into multiple scoped PRs
- If you cannot determine whether code is dead or unreachable, run `graph-navigator` for blast radius before deleting; if uncertainty remains, leave it and flag in the output
- If the user asked for a narrow simplification but you find unrelated complexity, list it in the output as "noticed but not touching" — do not silently expand scope
