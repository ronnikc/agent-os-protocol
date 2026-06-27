Title: Source-Driven Development
Keywords: source-driven, official-docs, citations, framework-versions, hallucination-prevention, verification, anti-hallucination
Agents: backend, frontend, api, test, research, documentation, accessibility
When to use: When implementing or modifying framework-specific code (React 19 hooks, Express middleware, Vitest mocks, MongoDB drivers, Playwright APIs, Tailwind utilities, Zod schemas, etc.) — before writing the first line. Also use when reviewing code that uses framework patterns of unclear vintage.
Version: 1.0.0
Last updated: 2026-04-27

Ground every framework-specific decision in official documentation. Don't implement from memory — fetch the docs for the exact version in `package.json`, follow the documented pattern, cite the source in code or PR. Directly addresses the "agents hallucinate method names, field names, and type shapes" failure mode listed in SUB-AGENTS.md → Common Agent Errors. Adapted from [addyosmani/agent-skills source-driven-development](https://github.com/addyosmani/agent-skills/blob/main/skills/source-driven-development/SKILL.md).

---

## The Process

```
DETECT ──→ FETCH ──→ IMPLEMENT ──→ CITE
  │          │           │            │
  ▼          ▼           ▼            ▼
 What       Get the    Follow the   Show your
 stack?     relevant   documented   sources
            docs       patterns
```

### Step 1 — Detect Stack and Versions

Read the dependency files this project uses:

```
the backendpackage.json   → Express, Mongoose, MongoDB driver, Zod, bcrypt, helmet
the frontendpackage.json  → React, Vite, Tailwind, react-router, useLocale custom hooks
the shared packagepackage.json    → Zod, ulid, shared types
package.json (root)        → Vitest, Playwright, Husky, ESLint, Prettier
```

State what you found explicitly in your first response:

```
STACK DETECTED:
- React 19.x (the frontendpackage.json)
- Express 4.x + native MongoDB driver (the backendpackage.json)
- Vitest 1.x with @vitest/ui (root package.json)
→ Fetching official docs for the relevant patterns.
```

If versions are missing or ambiguous, **ask the user** before guessing. The version determines which patterns are correct.

### Step 2 — Fetch Official Documentation

Fetch the specific docs page for the feature you're implementing — not the homepage, not the full docs.

**Source hierarchy (in order of authority):**

| Priority | Source | Example |
|----------|--------|---------|
| 1 | Official documentation | `react.dev`, `expressjs.com/en/api.html`, `mongodb.github.io/node-mongodb-native`, `vitest.dev` |
| 2 | Official blog / changelog | `react.dev/blog`, `vitejs.dev/blog` |
| 3 | Web standards references | MDN, web.dev, html.spec.whatwg.org |
| 4 | Browser/runtime compatibility | caniuse.com, node.green |

**Not authoritative — never cite as primary sources:**

- Stack Overflow answers
- Blog posts or tutorials (even popular ones)
- AI-generated documentation or summaries
- Your own training data — that is the whole point: verify it

**Be precise:**

```
BAD:  Fetch the React homepage
GOOD: Fetch react.dev/reference/react/useActionState

BAD:  Search "mongodb update best practices"
GOOD: Fetch mongodb.github.io/node-mongodb-native/6.x/classes/Collection.html#updateOne
```

When official sources conflict (e.g. a migration guide contradicts the API reference), surface the discrepancy and verify which pattern works against the detected version.

### Step 3 — Implement Following Documented Patterns

Write code that matches the documentation:

- Use API signatures from the docs, not from memory
- If docs show a new way, use the new way
- If docs deprecate a pattern, don't use it
- If docs don't cover something, flag it as **UNVERIFIED**

**When docs conflict with existing project code, surface it:**

```
CONFLICT DETECTED:
The existing codebase uses useState for form loading state,
but React 19 docs recommend useActionState for this pattern.
(Source: https://react.dev/reference/react/useActionState)

Options:
A) Use the modern pattern (useActionState) — consistent with current docs
B) Match existing code (useState) — consistent with codebase
→ Which approach do you prefer?
```

Don't silently pick one.

### Step 4 — Cite Your Sources

Every framework-specific pattern gets a citation. The reviewer must be able to verify each decision.

**In code comments (sparingly — only for non-obvious patterns):**

```typescript
// React 19 form handling with useActionState
// Source: https://react.dev/reference/react/useActionState#usage
const [state, formAction, isPending] = useActionState(submitOrder, initialState);
```

**In conversation / PR description:**

```
I'm using useActionState instead of manual useState/setIsPending.
Source: https://react.dev/blog/2024/12/05/react-19#actions
"useTransition now supports async functions [...] to handle pending states automatically"
```

**Citation rules:**

- Full URLs, not shortened
- Prefer deep links with anchors (e.g. `/useActionState#usage`) — anchors survive doc restructuring
- Quote the relevant passage when supporting a non-obvious decision
- If you cannot find documentation for a pattern, say so explicitly:

```
UNVERIFIED: I could not find official documentation for this pattern.
This is based on training data and may be outdated. Verify before merge.
```

Honesty about what you couldn't verify is more valuable than false confidence.

---

## Project-Specific Verification

Before treating any framework call as "verified," also confirm:

- **Real source over docs:** read the shared types, the real service file, and the real route file before calling/mocking them. Docs tell you the framework API; project source tells you our types and method names.
- **MongoDB ObjectId casting:** every `_id` use in TypeScript needs `as unknown as string`, never `as string` (Incident 14 in SUB-AGENTS.md).
- **Express params:** `req.params.x` is `string | string[]` — narrow with `as string` before passing to a service.
- **Shared type alignment:** every field a service writes to MongoDB must exist in the shared type definition (verified by build-validation).

This skill complements `pattern-compliance` and `build-validation` — they catch project-specific drift; this skill catches framework drift.

---

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "I'm confident about this API" | Confidence is not evidence. Training data contains outdated patterns that look correct but break against current versions. Verify. |
| "Fetching docs wastes tokens" | Hallucinating an API wastes more. One fetch prevents hours of post-merge rework — see Incident 14. |
| "The docs won't have what I need" | If docs don't cover it, that's valuable information — the pattern may not be officially recommended. |
| "I'll just mention it might be outdated" | A disclaimer doesn't help. Either verify and cite, or clearly flag UNVERIFIED. Hedging is the worst option. |
| "This is a simple task, no need to check" | Simple tasks with wrong patterns become templates. The wrong form handler gets copied into ten components before discovery. |

---

## Red Flags — STOP and Verify

- Writing framework-specific code without checking docs for that version
- Using "I believe" or "I think" about an API instead of citing the source
- Implementing a pattern without knowing which version it applies to
- Citing Stack Overflow or blog posts instead of official documentation
- Using deprecated APIs because they appear in training data
- Not reading `package.json` before implementing
- Delivering code without source citations for non-trivial framework decisions
- Mocking a service or hook without first reading the real file

---

## Input Schema

```yaml
input:
  task_description:
    type: string
    required: true
    description: "Feature or bugfix to implement"
  affected_workspaces:
    type: array
    items:
      type: enum
      values: [shared, backend, frontend, e2e, root]
    required: true
    description: "Which workspaces will be modified — determines which package.json files to read"
  framework_areas:
    type: array
    items: string
    required: true
    description: "Specific framework areas the task touches (e.g., 'React hooks', 'MongoDB updateOne', 'Express middleware', 'Vitest mocks', 'Zod schemas')"
  novel_pattern:
    type: boolean
    required: false
    default: false
    description: "If true, the task introduces a pattern not yet present in the codebase — increases citation requirements"
```

## Output Schema

```yaml
output:
  stack_detected:
    type: object
    description: "Versions read from package.json files for each affected workspace"
    properties:
      workspace: { type: string }
      libraries: { type: array, items: { type: object, properties: { name: string, version: string } } }
  sources_consulted:
    type: array
    items:
      type: object
      properties:
        url: { type: string, description: "Full URL with deep-link anchor where possible" }
        framework: { type: string }
        version_applies_to: { type: string }
        passage_quoted: { type: string, description: "Relevant excerpt, optional" }
  decisions:
    type: array
    items:
      type: object
      properties:
        pattern_used: { type: string }
        source_url: { type: string }
        conflicts_with_codebase: { type: boolean, description: "True if existing code uses a different pattern — must be surfaced to user" }
  unverified_items:
    type: array
    items:
      type: object
      properties:
        pattern: { type: string }
        reason_not_verified: { type: string }
```

## Quality Gate

- Every framework-specific decision in the changeset has a source URL recorded (in code comment, PR description, or output)
- All cited URLs point to official documentation — no Stack Overflow, no blog posts, no AI summaries
- The version each citation applies to matches the version in the project's `package.json`
- Any pattern that could not be verified is explicitly flagged as UNVERIFIED in the output
- Conflicts between official docs and existing project code were surfaced to the user, not silently resolved
- Real source files (the shared types, real service/route files) were read before mocking or calling

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "source-driven-development"
  stage: "S1"
  suggested_next:
    - slug: "tdd-discipline"
      stage: "S3"
      reason: "Once the framework pattern is verified, write the failing test before the implementation"
    - slug: "pattern-compliance"
      stage: "S3"
      reason: "After implementation, verify project-specific patterns (AppError, RBAC, audit) on top of framework-correct code"
    - slug: "build-validation"
      stage: "S1"
      reason: "Run tsc to confirm the documented API was used correctly against the real type definitions"
```

## Error Handling

- If `package.json` is missing or version is ambiguous, ask the user before proceeding — do not guess
- If official docs are unreachable (network failure), retry once; if still unreachable, mark the pattern UNVERIFIED and flag in the output rather than guessing
- If docs conflict with existing project code, surface both options to the user — never silently pick one
- If a deprecated API still works in the project's pinned version, prefer the modern replacement only if no consumers depend on the deprecated behavior — otherwise document the deferral and link to the migration ADR
- If the framework's "best practice" conflicts with a project-specific rule (e.g., framework says `_id as string`, project says `as unknown as string`), the project rule wins — but document the conflict in code comments
