Title: Incremental Implementation
Keywords: incremental, vertical-slice, feature-flag, scope-discipline, atomic-commits, rollback, thin-slice, simplicity
Agents: backend, frontend, api, test, infrastructure
When to use: When implementing any multi-file change, building a new feature from a sprint task breakdown, refactoring existing code, or any time you're tempted to write more than ~100 lines before testing. NOT for single-file, single-function changes where scope is already minimal.
Version: 1.0.0
Last updated: 2026-04-27

Build in thin vertical slices — implement one piece, test it, verify it, commit, then expand. Each increment leaves the system in a working, testable state. This is the execution discipline that prevents the Sprint 12.9.0 class of crash (66/81 files lost) and the "agent wrote 2000 lines, none of which compile" failure mode. Adapted from [addyosmani/agent-skills incremental-implementation](https://github.com/addyosmani/agent-skills/blob/main/skills/incremental-implementation/SKILL.md).

---

## The Increment Cycle

```
┌──────────────────────────────────────┐
│                                      │
│   Implement ──→ Test ──→ Verify ──┐  │
│       ▲                           │  │
│       └───── Commit ◄─────────────┘  │
│              │                       │
│              ▼                       │
│          Next slice                  │
│                                      │
└──────────────────────────────────────┘
```

For each slice:

1. **Implement** the smallest complete piece of functionality
2. **Test** — run the relevant test file (and write one first if doing TDD — see `tdd-discipline`)
3. **Verify** — `tsc --noEmit`, `vitest run <file>`, lint pass, feature manually checked if UI
4. **Commit** — descriptive, atomic message tying back to the sprint task ID
5. **Move to the next slice** — carry forward, don't restart

---

## Slicing Strategies

### Vertical Slices (Preferred)

Build one complete path through the stack. For a typical sprint task:

```
Slice 1: Shared types + service skeleton (DB read/write + AppError + audit hook)
    → tsc shared, tsc backend, vitest run service.test.ts → all green

Slice 2: Route layer (RBAC + Zod validation + error handling)
    → vitest run routes.test.ts → green

Slice 3: API client method (frontend services/api-client.ts)
    → tsc frontend → green, mock test updated

Slice 4: Frontend page/component (useLocale, semantic HTML, accessibility)
    → component test updated, full frontend vitest pass

Slice 5: Seed data + i18n keys across multiple locales
    → seed runs, i18n keys present in every locale, runtime check
```

Each slice delivers working end-to-end functionality and can be committed independently.

### Contract-First Slicing

When backend and frontend can be built in parallel by different agents:

```
Slice 0: Define the API contract — shared types, route signatures, error codes
Slice 1a: Backend implements against the contract + service/route tests (Backend agent)
Slice 1b: Frontend implements against mocked contract + component tests (Frontend agent)
Slice 2: Integrate, run E2E, fix mismatches
```

### Risk-First Slicing

Tackle the riskiest piece first:

```
Slice 1: Prove the WebSocket relay works (highest risk — Sprint 17.8.0 lesson)
Slice 2: Build real-time updates on the proven connection
Slice 3: Add reconnection and offline behavior
```

If Slice 1 fails, you discover it before investing in Slices 2 and 3.

---

## Implementation Rules

### Rule 0 — Simplicity First

Before writing any code, ask: "What is the simplest thing that could work?" After writing, review against:

- Can this be done in fewer lines?
- Are these abstractions earning their complexity?
- Would a Code Review Specialist say "why didn't you just..."?
- Am I building for hypothetical future requirements, or the current sprint task?

```
SIMPLICITY CHECK:
✗ Generic event-bus with middleware pipeline for one notification
✓ Direct service call

✗ Abstract factory for two similar pages
✓ Two straightforward pages with shared utilities

✗ Config-driven form builder for three forms
✓ Three form components
```

Implement the naive, obviously-correct version first. Optimize only after correctness is proven with tests.

### Rule 0.5 — Scope Discipline (HIGH-PRIORITY)

Touch only what the task requires. This is the single most-violated rule in agent work.

**Do NOT:**
- "Clean up" code adjacent to your change
- Refactor imports in files you're not modifying
- Remove comments you don't fully understand
- Add features not in the spec because they "seem useful"
- Modernize syntax in files you're only reading

If you notice something worth improving outside scope, **note it, don't fix it:**

```
NOTICED BUT NOT TOUCHING:
- src/utils/format.ts has an unused import (unrelated to this task)
- The auth middleware could use better error messages (separate task)
→ Want me to create tasks for these?
```

The Code Review Specialist will reject scope-violating changes. The Boss Agent tracks scope creep across sessions.

### Rule 1 — One Thing at a Time

Each commit changes one logical thing. **Bad:** one commit that adds a component, refactors another, and updates the build config. **Good:** three commits.

### Rule 2 — Keep It Compilable

After each increment, the project must build (`tsc`) and existing tests must pass. Never leave the codebase broken between slices.

### Rule 3 — Feature Flags for Incomplete Features

If a feature isn't ready for users but you need to merge increments:

```typescript
// In the shared package (existing pattern)
export const FEATURE_FLAGS = {
  RISK_BULK_IMPORT: process.env.FEATURE_RISK_BULK_IMPORT === 'true',
} as const;

if (FEATURE_FLAGS.RISK_BULK_IMPORT) {
  // New WIP UI / route
}
```

This lets you merge small increments to the main branch without exposing incomplete work to users.

### Rule 4 — Safe Defaults

New code defaults to safe, conservative behavior:

```typescript
export async function createRisk(
  org_id: string,
  data: CreateRiskInput,
  options?: { notify?: boolean }
) {
  const shouldNotify = options?.notify ?? false; // notifications opt-in
  // ...
}
```

### Rule 5 — Rollback-Friendly

Each increment should be independently revertable:

- Additive changes (new files, new functions) revert cleanly
- Modifications to existing code stay minimal and focused
- Database migrations need corresponding rollback migrations
- Don't delete-and-replace in the same commit — separate them

---

## Verification Per Increment (MANDATORY)

After each slice, run the verification stack — same as the Self-Verification Gate in SUB-AGENTS.md:

```bash
# 1. Shared types if modified
npx tsc -p the shared packagetsconfig.json

# 2. Backend types if modified
npx tsc -p the backendtsconfig.json --noEmit

# 3. Frontend types if modified
npx tsc -p the frontendtsconfig.json --noEmit

# 4. Specific test file for the slice
npx vitest run path/to/affected.test.ts

# 5. Full frontend test suite at the END of all slices (Incident 15)
cd the frontend && npx vitest run

# 6. If backend files modified
cd the backend && npx vitest run

# 7. Lint + format
npm run lint && npm run format:check
```

If ANY command fails, fix it before the next slice. Do NOT accumulate broken state.

---

## Coordination Triggers (See SUB-AGENTS.md § 3)

When a slice triggers cross-agent work, surface it BEFORE proceeding:

| Slice changes | Coordinate with | Why |
|--------------|-----------------|-----|
| Backend service/route | Test Specialist | Service tests need updating before merge |
| Frontend component text | Test Specialist + I18N | Component test mocks + multiple locales files |
| Route response messages | Test Specialist | grep test assertions for old strings (Incident 14) |
| Shared type modification | Backend + Frontend + Test | Test factory Zod validation catches mismatches |
| New permission | Security + Backend (the role-seed file) | Permission seeding required before route gate works |

---

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "I'll test it all at the end" | Bugs compound. A bug in Slice 1 makes Slices 2-5 wrong. |
| "It's faster to do it all at once" | Feels faster until something breaks and you can't find which of 500 lines caused it. |
| "These changes are too small to commit separately" | Small commits are free. Large commits hide bugs and make rollbacks painful. |
| "I'll add the feature flag later" | If the feature isn't complete, it shouldn't be user-visible. Add the flag now. |
| "This refactor is small enough to include" | Mixed refactor + feature changes are harder to review and debug. Separate them. |
| "I'm an agent, I don't need to commit between slices" | The session can crash. Sprint 12.9.0 lost 66 files mid-task. Commit every working slice. |

---

## Red Flags — STOP

- More than 100 lines written without running tests
- More than 800 lines written without committing (crash-prevention threshold)
- Multiple unrelated changes in a single increment
- "Let me just quickly add this too" scope expansion
- Skipping the test/verify step to move faster
- Build or tests broken between increments
- Touching files outside the task scope "while I'm here"
- Creating new utility files for one-time operations
- Building abstractions before the third use case demands it

---

## Input Schema

```yaml
input:
  task_id:
    type: string
    required: true
    description: "Sprint task ID this implementation maps to (e.g., '18.5.0-task-3')"
  task_description:
    type: string
    required: true
    description: "What the task implements"
  affected_layers:
    type: array
    items:
      type: enum
      values: [shared-types, backend-service, backend-route, frontend-page, frontend-component, seed-data, i18n, e2e, infrastructure]
    required: true
    description: "Which layers of the stack this task touches — drives slicing strategy"
  slicing_strategy:
    type: enum
    values: [vertical, contract-first, risk-first]
    required: false
    default: vertical
  feature_flag_required:
    type: boolean
    required: false
    default: false
    description: "True if the feature must merge incrementally before being user-visible"
```

## Output Schema

```yaml
output:
  slices:
    type: array
    items:
      type: object
      properties:
        slice_number: { type: integer }
        description: { type: string }
        files_changed: { type: array, items: string }
        line_count: { type: integer }
        verification:
          type: object
          properties:
            tsc_passed: { type: boolean }
            tests_run: { type: array, items: string }
            tests_passed: { type: boolean }
            lint_passed: { type: boolean }
        commit_sha: { type: string }
        coordination_triggered:
          type: array
          description: "Other agents that needed to be brought in for this slice"
          items: { type: object, properties: { agent: string, reason: string } }
  noticed_but_not_touched:
    type: array
    items:
      type: object
      properties:
        location: { type: string }
        observation: { type: string }
        suggested_followup_task: { type: string }
  feature_flag:
    type: object
    description: "Populated only if feature_flag_required was true"
    properties:
      flag_name: { type: string }
      default_value: { type: boolean }
      file_added: { type: string }
```

## Quality Gate

- Every slice ends with green tsc + green tests + clean lint — no slice committed in a broken state
- No slice exceeds ~200 lines of net change (split larger work into more slices)
- No commit mixes refactor + feature work
- Every cross-agent coordination trigger from SUB-AGENTS.md § 3 was honored before merge
- Feature flag in place if the work merges before being user-ready
- Full frontend test suite green after the final slice (`cd the frontend && npx vitest run`)
- Backend test suite green if backend layers were touched
- All `noticed_but_not_touched` items are listed in output, not silently fixed

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "incremental-implementation"
  stage: "S1"
  suggested_next:
    - slug: "tdd-discipline"
      stage: "S3"
      reason: "Each slice should start with a failing test before the implementation"
    - slug: "verification-gate"
      stage: "S3"
      reason: "Final slice closes with full verification evidence"
    - slug: "code-review-and-quality"
      stage: "S3"
      reason: "Once all slices land, run a five-axis review on the cumulative diff"
    - slug: "review-request"
      stage: "S2"
      reason: "Dispatch structured review with the slice commit SHAs"
```

## Error Handling

- If a slice's verification fails, STOP — do not start the next slice. Fix in place or revert that slice
- If you cross 800 lines of uncommitted change, treat it as a crash-prevention violation — checkpoint immediately
- If the task spec turns out to be wrong mid-implementation, halt and route to the Planning Specialist — do not redesign the task on the fly
- If a coordination trigger is missed (e.g., backend service changed without Test Specialist update), block the merge and reach out before continuing
- If the session shows strain (truncated tool output, repeated failures), commit what's working, document where you stopped, and recommend a fresh session per SUB-AGENTS.md → Escalation Protocol
- If you find yourself wanting to silently expand scope, write the temptation into `noticed_but_not_touched` instead — that is the correct release valve
