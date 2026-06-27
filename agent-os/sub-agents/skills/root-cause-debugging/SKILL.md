Title: Root Cause Debugging
Keywords: debugging, root-cause, investigation, hypothesis, bug-fix, test-failure, error-tracing, systematic, diagnostic
Agents: backend, frontend, api, test, build-integrity, infrastructure
When to use: When encountering any bug, test failure, build failure, or unexpected behavior — before proposing fixes.
Version: 1.0.0
Last updated: 2026-03-18

Systematic debugging methodology: find root cause BEFORE attempting fixes. Random fixes waste time and create new bugs. Four phases: Root Cause Investigation → Pattern Analysis → Hypothesis Testing → Implementation. Iron law: no fixes without root cause investigation first.

---

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes. This applies especially when:
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- You don't fully understand the issue

---

## Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read error messages carefully** — don't skip past errors or warnings. Read stack traces completely. Note line numbers, file paths, error codes. They often contain the exact solution.

2. **Reproduce consistently** — can you trigger it reliably? What are the exact steps? If not reproducible, gather more data — don't guess.

3. **Check recent changes** — git diff, recent commits, new dependencies, config changes, environmental differences.

4. **Gather evidence in multi-component systems** — when the system has multiple layers (shared → backend → frontend, or CI → build → deploy):

```
For EACH component boundary:
  - Log what data enters the component
  - Log what data exits the component
  - Verify environment/config propagation
  - Check state at each layer

Run once to gather evidence showing WHERE it breaks.
THEN analyze evidence to identify failing component.
THEN investigate that specific component.
```

5. **Trace data flow backward** — where does the bad value originate? What called this with the bad value? Keep tracing up until you find the source. Fix at source, not at symptom.

---

## Phase 2: Pattern Analysis

1. **Find working examples** — locate similar working code in the same codebase. What works that's similar to what's broken?

2. **Compare against references** — if implementing a pattern, read the reference implementation COMPLETELY. Don't skim — read every line.

3. **Identify differences** — list every difference between working and broken, however small. Don't assume "that can't matter."

4. **Understand dependencies** — what other components, settings, config, or environment does this need?

---

## Phase 3: Hypothesis and Testing

1. **Form single hypothesis** — state clearly: "I think X is the root cause because Y." Be specific, not vague.

2. **Test minimally** — make the SMALLEST possible change to test the hypothesis. One variable at a time. Don't fix multiple things at once.

3. **Verify before continuing** — did it work? Yes → Phase 4. No → form NEW hypothesis. DON'T add more fixes on top.

---

## Phase 4: Implementation

1. **Create failing test case** — simplest possible reproduction. Automated test if possible. MUST have before fixing. Use the `test-patterns` skill for writing proper tests.

2. **Implement single fix** — address the root cause identified. ONE change at a time. No "while I'm here" improvements.

3. **Verify fix** — test passes? No other tests broken? Issue actually resolved?

4. **If fix doesn't work** — count how many fixes you've tried:
   - < 3: Return to Phase 1, re-analyze with new information
   - **≥ 3: STOP and question the architecture** (see below)

### After 3+ Failed Fixes: Question Architecture

**Pattern indicating architectural problem:**
- Each fix reveals new shared state, coupling, or problems in different places
- Fixes require "massive refactoring" to implement
- Each fix creates new symptoms elsewhere

**STOP and question fundamentals:**
- Is this pattern fundamentally sound?
- Should we refactor architecture vs. continue fixing symptoms?
- Escalate to the orchestrator or human before attempting more fixes

---

## Red Flags — STOP and Return to Phase 1

If you catch yourself thinking:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "Here are the main problems:" (listing fixes without investigation)
- Proposing solutions before tracing data flow
- "One more fix attempt" (when already tried 2+)

**ALL of these mean: STOP. Return to Phase 1.**

---

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Issue is simple, don't need process" | Simple issues have root causes too. Process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check thrashing. |
| "Just try this first, then investigate" | First fix sets the pattern. Do it right from the start. |
| "I'll write test after confirming fix" | Untested fixes don't stick. Test first proves it. |
| "Multiple fixes at once saves time" | Can't isolate what worked. Causes new bugs. |
| "I see the problem, let me fix it" | Seeing symptoms ≠ understanding root cause. |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem. Question the pattern. |

---

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| 1. Root Cause | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| 2. Pattern | Find working examples, compare | Identify differences |
| 3. Hypothesis | Form theory, test minimally | Confirmed or new hypothesis |
| 4. Implementation | Create test, fix, verify | Bug resolved, tests pass |

---

## Checklist

- [ ] Error messages read completely (stack traces, line numbers, codes)
- [ ] Issue reproduced consistently (or documented as non-reproducible)
- [ ] Recent changes checked (git diff, commits, config)
- [ ] Evidence gathered at component boundaries (for multi-layer issues)
- [ ] Working examples found and compared
- [ ] Single hypothesis formed and stated clearly
- [ ] Minimal change made to test hypothesis
- [ ] Failing test case created before implementing fix
- [ ] Single fix addresses root cause (not symptom)
- [ ] All tests pass after fix
- [ ] No other tests broken by fix

## Input Schema

```yaml
input:
  error_description:
    type: string
    required: true
    description: "Description of the bug, test failure, build failure, or unexpected behavior"
  error_output:
    type: string
    required: false
    description: "Full error message, stack trace, or log output"
  affected_files:
    type: array
    items: string
    required: false
    description: "File paths suspected to be involved in the issue"
  recent_changes:
    type: string
    required: false
    description: "Recent git diff, commits, or config changes that may be relevant"
```

## Output Schema

```yaml
output:
  diagnosis:
    type: object
    description: "Root cause analysis and fix result"
    properties:
      root_cause:
        type: string
      evidence:
        type: array
        items: string
      hypothesis_tested:
        type: string
      fix_applied:
        type: object
        properties:
          file: string
          description: string
      test_created:
        type: boolean
      all_tests_pass:
        type: boolean
      fix_attempts:
        type: integer
```

## Quality Gate

- Root cause has been identified with supporting evidence before any fix is proposed.
- A failing test case reproducing the issue exists before the fix is implemented.
- The fix addresses the root cause (not a symptom) and all existing tests continue to pass.
- If 3+ fix attempts have failed, architecture has been questioned and escalation considered.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "root-cause-debugging"
  stage: "S3"
  suggested_next:
    - slug: "verification-gate"
      stage: "S3"
      reason: "Verify the fix with fresh evidence before claiming it is resolved"
    - slug: "review-request"
      stage: "S2"
      reason: "Request code review for the bug fix, especially for complex fixes"
```

## Error Handling

- If the error cannot be reproduced consistently, gather additional diagnostic data (logs, environment info, timing) and document as non-reproducible rather than guessing at a fix.
- If stack traces reference third-party dependencies, check dependency versions and changelogs before modifying application code.
- If 3+ fix attempts fail, stop fixing and escalate to the orchestrator or human with a summary of all hypotheses tested and evidence gathered.
