Title: TDD Discipline
Keywords: tdd, test-driven-development, red-green-refactor, test-first, failing-test, minimal-code, discipline
Agents: test, backend, frontend, api
When to use: When implementing any feature or bugfix — before writing implementation code. Enforces the Red-Green-Refactor cycle.
Version: 1.0.0
Last updated: 2026-03-18

Strict Test-Driven Development discipline: write the test first, watch it fail, write minimal code to pass, refactor. This skill enforces the PROCESS of TDD. For project-specific test patterns (mocks, factories, Zod), see `test-patterns`. This skill is about WHEN and HOW you write tests, not the test code patterns themselves.

---

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over.

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete

**Violating the letter of the rules is violating the spirit of the rules.**

---

## Red-Green-Refactor Cycle

### RED — Write Failing Test

Write ONE minimal test showing what should happen.

**Requirements:**
- One behavior per test
- Clear name that describes the behavior
- Real code — no mocks unless unavoidable (use project mock patterns from `test-patterns` when mocks are needed)

### Verify RED — Watch It Fail (MANDATORY)

```bash
npx vitest run path/to/test.test.ts
```

Confirm:
- Test **fails** (not errors)
- Failure message is expected
- Fails because feature is missing (not typos)

**Test passes immediately?** You're testing existing behavior. Fix the test.

### GREEN — Minimal Code

Write the SIMPLEST code to pass the test. Nothing more.

- Don't add features beyond what the test requires
- Don't refactor other code
- Don't "improve" beyond the test

### Verify GREEN — Watch It Pass (MANDATORY)

```bash
npx vitest run path/to/test.test.ts
```

Confirm:
- Test passes
- Other tests still pass
- Output pristine (no errors, warnings)

**Test fails?** Fix code, not test.
**Other tests fail?** Fix now.

### REFACTOR — Clean Up

After green only:
- Remove duplication
- Improve names
- Extract helpers

Keep tests green. Don't add behavior.

### Repeat

Next failing test for next behavior.

---

## Bug Fix Protocol

Bug found? Write failing test reproducing it FIRST. Then follow TDD cycle. The test proves the fix and prevents regression.

**Never fix bugs without a test.**

---

## Red Flags — STOP and Start Over

- Code before test
- Test after implementation
- Test passes immediately (without writing production code)
- Can't explain why test failed
- Tests added "later"
- Rationalizing "just this once"
- "I already manually tested it"
- "Tests after achieve the same purpose"
- "It's about spirit not ritual"
- "Keep as reference" or "adapt existing code"
- "Already spent X hours, deleting is wasteful"
- "TDD is dogmatic, I'm being pragmatic"
- "This is different because..."

**All of these mean: Delete code. Start over with TDD.**

---

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Tests after achieve same goals" | Tests-after = "what does this do?" Tests-first = "what should this do?" |
| "Already manually tested" | Ad-hoc ≠ systematic. No record, can't re-run. |
| "Deleting X hours is wasteful" | Sunk cost fallacy. Keeping unverified code is technical debt. |
| "Need to explore first" | Fine. Throw away exploration, start with TDD. |
| "Test hard = TDD slows me down" | Hard-to-test = hard-to-use. Listen to the test. TDD is faster than debugging. |

---

## Verification Checklist

Before marking work complete:

- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing
- [ ] Each test failed for expected reason (feature missing, not typo)
- [ ] Wrote minimal code to pass each test
- [ ] All tests pass (`npx vitest run`)
- [ ] Output pristine (no errors, warnings)
- [ ] Tests use real code (mocks only if unavoidable)
- [ ] Edge cases and errors covered

Can't check all boxes? You skipped TDD. Start over.

---

## Related Skills

- `test-patterns` — project-specific test patterns: mock factories, Zod validation, coverage thresholds
- `coverage-enforcement` — CI coverage threshold verification
- `root-cause-debugging` — uses TDD for creating regression tests in Phase 4

## Input Schema

```yaml
input:
  task_description:
    type: string
    required: true
    description: "Description of the feature or bugfix to implement using TDD"
  test_file_path:
    type: string
    required: true
    description: "Path to the test file (e.g., the backend)"
  implementation_file_path:
    type: string
    required: true
    description: "Path to the production code file to be created or modified"
  is_bugfix:
    type: boolean
    required: false
    default: false
    description: "If true, follows the Bug Fix Protocol — write reproduction test first"
```

## Output Schema

```yaml
output:
  tdd_cycles:
    type: array
    items:
      type: object
      properties:
        cycle_number: { type: integer }
        test_name: { type: string }
        red_result: { type: string, description: "Failure message from the failing test" }
        green_result: { type: string, description: "Confirmation that test passes" }
        refactored: { type: boolean }
        files_changed: { type: array, items: string }
  verification_checklist:
    type: object
    description: "Results of the Verification Checklist — all boxes must be checked"
    properties:
      all_functions_tested: { type: boolean }
      watched_each_fail: { type: boolean }
      minimal_code_written: { type: boolean }
      all_tests_pass: { type: boolean }
      output_pristine: { type: boolean }
      edge_cases_covered: { type: boolean }
```

## Quality Gate

- Every new function or method has a corresponding test that was written before the implementation
- Each test was observed to fail for the expected reason (feature missing, not typo or import error)
- All tests pass with pristine output (no errors, no warnings)
- No production code exists without a preceding failing test in the TDD cycle log

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "tdd-discipline"
  stage: "S3"
  suggested_next:
    - slug: "pattern-compliance"
      stage: "S3"
      reason: "After TDD implementation, verify the code follows all project patterns"
    - slug: "agent-task-execution"
      stage: "S2"
      reason: "TDD-completed task is ready for two-stage review (spec compliance then code quality)"
```

## Error Handling

- If a test passes immediately without writing production code, the test is invalid — delete it and rewrite to test genuinely missing behavior
- If production code was written before the test (red flag detected), delete the production code entirely and restart the TDD cycle from scratch
- If a test fails for an unexpected reason (import error, typo, wrong mock), fix the test infrastructure issue first before counting it as a valid RED step
- If refactoring breaks a passing test, revert the refactoring and try a smaller refactoring step
