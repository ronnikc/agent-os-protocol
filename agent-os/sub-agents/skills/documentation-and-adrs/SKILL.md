Title: Documentation and ADRs
Keywords: documentation, adr, architecture-decision-record, why-not-what, inline-comments, api-docs, changelog, claude-md
Agents: documentation, planning, product, code-review, backend, frontend, infrastructure, security
When to use: When making a significant architectural decision (framework, data model, auth strategy, deployment pattern). When changing public APIs. When shipping features that change user-facing behavior. When you find yourself explaining the same thing repeatedly. NOT for obvious code or throwaway prototypes.
Version: 1.0.0
Last updated: 2026-04-27

Document decisions, not just code. The most valuable documentation captures the **why** — the context, constraints, and trade-offs that led to a decision. Code shows what was built; ADRs and docs explain why it was built this way and what alternatives were considered. This skill complements `doc-housekeeping` (which maintains the existing 9 mandatory docs post-sprint) by establishing how to capture new architectural decisions before they're forgotten. Adapted from [addyosmani/agent-skills documentation-and-adrs](https://github.com/addyosmani/agent-skills/blob/main/skills/documentation-and-adrs/SKILL.md).

---

## Architecture Decision Records (ADRs)

ADRs capture reasoning behind significant technical decisions. Highest-value documentation per minute spent.

### When to Write an ADR

- Choosing a framework, library, or major dependency
- Designing a data model or schema (especially workspace-scoped scoping rules)
- Selecting an authentication or authorization strategy
- Deciding on an API architecture (REST shape, error envelope, pagination contract)
- Choosing between build tools, hosting, infrastructure
- Any decision that would be **expensive to reverse**
- Resolving a meaningful conflict surfaced via `source-driven-development` (project pattern vs. framework-recommended pattern)

### Where ADRs Live

```
docs/decisions/
  ADR-0001-workspace-scoped-org-scoping.md
  ADR-0002-mongodb-as-primary-store.md
  ADR-0003-i18n-key-structure.md
  ...
```

Sequential numbering. Don't renumber when one is superseded — write a new one that supersedes the old.

### ADR Template

```markdown
# ADR-NNNN: <Short imperative title>

## Status
Proposed | Accepted | Superseded by ADR-XXXX | Deprecated

## Date
YYYY-MM-DD

## Context
What forces are at play? What constraints, requirements, or non-functional needs drove this decision?
Quantify where possible. Link to the sprint spec, incident, or user-validation finding that triggered the decision.

## Decision
The chosen approach, stated clearly. One paragraph. No "we will probably."

## Alternatives Considered

### Option A
- Pros:
- Cons:
- Rejected because: <specific reason tied to the Context>

### Option B
- Pros:
- Cons:
- Rejected because: ...

(Always document the alternatives — even briefly. The "why not X?" is what future readers need.)

## Consequences

### Positive
- ...

### Negative / Trade-offs
- ...

### Follow-ups
- Owners, dates, sprint task IDs for any work this decision creates.

## References
- Sprint spec: docs
- Source documentation: <full URL>
- Incident or user-validation report (if applicable)
```

### ADR Lifecycle

```
PROPOSED → ACCEPTED → (SUPERSEDED-BY-ADR-XXXX or DEPRECATED)
```

- **Don't delete old ADRs** — they capture historical context.
- When a decision changes, write a new ADR that **references and supersedes** the old one.
- Update the old ADR's `Status` line to point to the superseder.

---

## Inline Documentation

### When to Comment

Comment the **why**, not the **what**.

```typescript
// BAD: restates the code
// Increment counter by 1
counter += 1;

// GOOD: explains non-obvious intent
// Sliding window — reset at boundary, not on a fixed schedule, to prevent
// burst attacks at window edges. See ADR-0007.
if (now - windowStart > WINDOW_SIZE_MS) {
  counter = 0;
  windowStart = now;
}
```

### When NOT to Comment

```typescript
// Don't comment self-explanatory code
function calculateTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// Don't leave TODO for things you should just do now
// TODO: add error handling   ← just add it

// Don't leave commented-out code — git remembers
// const oldImpl = () => { ... }   ← delete it
```

### Document Project-Specific Gotchas Inline

The `pattern-compliance` skill calls out several "weird-looking" patterns that are required for safety. When introducing one, leave a one-line comment so future readers don't try to "simplify" it:

```typescript
// MongoDB ObjectId cast — required by Incident 14, see code-simplification §Chesterton fences
const id = doc._id as unknown as string;

// Express params type compat — req.params.x is string | string[]
const orgId = req.params.orgId as string;

// `as any` on requirePermission is required for Express middleware type compat
router.post('/', requirePermission(Permission.RISK_CREATE) as any, handler);
```

These comments save future agents from re-investigating Chesterton fences.

---

## API Documentation

### Inline with Types (Preferred for TypeScript)

```typescript
/**
 * Create a new risk for the given organization.
 *
 * @param org_id - Workspace scope; service rejects writes that don't match the caller's org_id
 * @param input  - Risk creation data (title required, severity defaults to 'medium')
 * @returns      - The created risk with server-generated _id and timestamps
 * @throws {AppError} 422 VALIDATION_ERROR — input fails schema validation
 * @throws {AppError} 403 FORBIDDEN         — caller lacks RISK_CREATE permission
 *
 * @example
 * const risk = await riskService.create(session.org_id, { title: 'New risk' });
 */
export async function create(
  org_id: string,
  input: CreateRiskInput,
): Promise<Risk> {
  // ...
}
```

The TypeScript types + JSDoc together serve as API documentation. No separate Swagger doc needed for internal services.

### REST Contract Documentation

For the public API surface (what `api-contract-validation` enforces), document the contract once per resource in the API-contract docs. Include:

- Endpoint and verb
- Required permission
- Request schema (link to Zod schema)
- Response schema (link to shared type)
- Error codes returned
- Pagination contract for list endpoints
- Audit events emitted

---

## README Structure

The repo root README and per-workspace READMEs should cover:

```markdown
# <Project / Workspace Name>

One-paragraph description of what this does.

## Quick Start
1. Clone
2. `npm install` (or `pnpm install`)
3. `cp .env.example .env` and fill in values
4. `npm run dev` (or workspace-specific)

## Commands
| Command            | Description                |
|--------------------|----------------------------|
| `npm run dev`      | Start development server   |
| `npm test`         | Run vitest                 |
| `npm run build`    | Production build           |
| `npm run lint`     | Run ESLint                 |
| `npm run e2e`      | Run Playwright E2E         |

## Architecture
Brief overview, link to ADRs in `docs/decisions/` for details.

## Contributing
Link to CLAUDE.md and AGENTS.md for agent-driven workflow.
```

---

## Changelog Maintenance

For shipped features (already covered by `release-notes` skill, but the format reference):

```markdown
# Changelog

## [1.2.0] - 2026-01-20

### Added
- Risk bulk import (#123)
- Email notifications for control assignments (#124)

### Fixed
- Duplicate risks when rapidly clicking create (#125)

### Changed
- Risk list now loads 50 items per page (was 20) (#126)

### Deprecated
- Old `/api/v1/risks` endpoint — migrate to `/api/v2/risks` by 2026-06-01 (see ADR-0042)
```

---

## Documentation for Agents

This codebase relies heavily on agent-readable documentation. Special considerations:

- **CLAUDE.md** — repo root: build commands, code patterns, conventions. Agents read it first.
- **AGENTS.md** — agent-specific protocols.
- **agent-os/RULES.md** — non-negotiable rules. Whisper-injected on every prompt.
- **agent-os/SUB-AGENTS.md** — agent roster, routing, parallelism.
- **Sprint specs** in docs — agents read the spec before writing code.
- **ADRs** in `docs/decisions/` — prevent re-deciding the same architectural questions.
- **Inline gotcha comments** — prevent agents falling into known traps.

When you make a decision that future agents will need, ask: "Where will the next agent look for this?" Put it there.

---

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "The code is self-documenting" | Code shows what. It doesn't show why, what alternatives were rejected, or what constraints apply. |
| "We'll write docs when the API stabilizes" | APIs stabilize faster when you document them. The doc is the first test of the design. |
| "Nobody reads docs" | Agents do. Future engineers do. Your 3-months-later self does. |
| "ADRs are overhead" | A 10-minute ADR prevents a 2-hour debate about the same decision six months later. |
| "Comments get outdated" | Comments on **why** are stable. Comments on **what** get outdated — that's why you only write the former. |
| "It's just an internal tool" | This is a platform with regulated users. Decisions need traceability. |

---

## Red Flags

- Architectural decisions with no written rationale
- Public APIs with no JSDoc or shared-type documentation
- README that doesn't explain how to run the project
- Commented-out code instead of deletion
- TODO/FIXME comments older than one sprint
- No ADRs in a project with significant architectural choices
- Documentation that restates the code instead of explaining intent
- A weird-looking required pattern with no Chesterton-fence comment

---

## Input Schema

```yaml
input:
  doc_type:
    type: enum
    values: [adr, inline-comment, api-doc, readme, changelog, claude-md-update]
    required: true
  trigger:
    type: enum
    values: [significant-decision, api-change, feature-ship, recurring-question, source-driven-conflict, sprint-close]
    required: true
  context:
    type: object
    required: true
    properties:
      decision_summary: { type: string }
      sprint_task_id: { type: string }
      affected_files: { type: array, items: string }
      alternatives_considered: { type: array, items: string, description: "Required for ADR" }
  superseding_adr:
    type: string
    required: false
    description: "If writing a new ADR that replaces an old one, the slug/number being superseded"
```

## Output Schema

```yaml
output:
  artifacts:
    type: array
    items:
      type: object
      properties:
        type:
          type: enum
          values: [adr, inline-comment, jsdoc, readme-section, changelog-entry, claude-md-update]
        path: { type: string, description: "Where the artifact was written" }
        title: { type: string }
        summary: { type: string, description: "Under 50 words" }
  adr_metadata:
    type: object
    description: "Populated only when type is adr"
    properties:
      number: { type: integer }
      title: { type: string }
      status:
        type: enum
        values: [Proposed, Accepted, Superseded, Deprecated]
      supersedes: { type: string, description: "Number of the ADR being superseded, if any" }
      superseded_by: { type: string, description: "Set on the OLD ADR when a new one supersedes it" }
  cross_references_added:
    type: array
    description: "Other docs updated to point at the new artifact"
    items: { type: object, properties: { file: string, change: string } }
```

## Quality Gate

- Every significant architectural decision in the changeset has an ADR (or links to an existing one)
- ADRs include Context, Decision, Alternatives Considered (with rejection reasons), Consequences
- ADR numbering is sequential — no duplicates, no renumbering
- Superseded ADRs are not deleted — their Status line points to the superseder
- Inline comments explain WHY, not WHAT — no comments restating obvious code
- Required-but-weird-looking patterns have one-line Chesterton-fence comments
- Public TypeScript exports have JSDoc with `@param`, `@returns`, `@throws`
- No commented-out code or TODOs older than the current sprint left in the diff
- CLAUDE.md, AGENTS.md, RULES.md updated if the decision changes agent behavior

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "documentation-and-adrs"
  stage: "S5"
  suggested_next:
    - slug: "doc-housekeeping"
      stage: "S5"
      reason: "Run end-of-sprint doc housekeeping to ensure all 9 mandatory files reflect the new ADR"
    - slug: "release-notes"
      stage: "S5"
      reason: "Surface user-facing decisions in the release notes"
    - slug: "code-review-and-quality"
      stage: "S3"
      reason: "Have the new ADR reviewed alongside the implementation"
```

## Error Handling

- If a decision is made without an ADR but the diff includes a non-trivial architectural change, file the ADR retroactively in the same PR — do NOT merge without it
- If two ADRs conflict (intentionally or accidentally), mark the older one Superseded and update consumers — do not leave both Active
- If a JSDoc claim conflicts with the actual implementation, fix the implementation OR fix the doc — never let them drift
- If a "weird" pattern is added without a Chesterton comment, the Code Review Specialist should request one before approval
- If user-facing CLAUDE.md guidance changes, also update RULES.md if the change affects whisper-injected non-negotiables
- If unsure whether a decision warrants an ADR, default to writing one — small cost, large benefit if anyone re-debates the question later
