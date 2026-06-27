Title: Deprecation and Migration
Keywords: deprecation, migration, sunset, code-as-liability, churn-rule, hyrum, strangler, adapter, feature-flag-migration, zombie-code
Agents: planning, backend, frontend, api, infrastructure, release, documentation
When to use: When replacing an old system, API, or feature with a new one. When sunsetting a feature that's no longer needed. When consolidating duplicate implementations. When removing dead code. When deciding whether to maintain or sunset a legacy module. Also: when designing a new system — deprecation planning starts at design time.
Version: 1.0.0
Last updated: 2026-04-27

Code is a liability, not an asset. Every line has ongoing maintenance cost — bugs, dependency updates, security patches, onboarding overhead. Deprecation is the discipline of removing code that no longer earns its keep; migration is the process of moving users safely from old to new. Most engineering organizations build well and remove poorly — this skill addresses that gap. Adapted from [addyosmani/agent-skills deprecation-and-migration](https://github.com/addyosmani/agent-skills/blob/main/skills/deprecation-and-migration/SKILL.md).

---

## Core Principles

### Code Is a Liability

Every line has ongoing cost: tests, docs, security patches, dependency updates, mental overhead for anyone working nearby. The value is the **functionality**, not the code. When the same functionality can be provided with less code or better abstractions, the old code should go.

### Hyrum's Law Makes Removal Hard

> With enough users, every observable behavior becomes depended on — including bugs, timing quirks, and undocumented side effects.

Users can't "just switch" when they depend on behaviors the replacement doesn't replicate. This is why deprecation requires **active migration**, not just announcement.

### Deprecation Planning Starts at Design Time

When building something new, ask: "How would we remove this in 3 years?" Systems with clean interfaces, feature flags, and minimal surface area are easier to deprecate than systems that leak implementation details.

For new sprint work, the `incremental-implementation` Rule 3 (feature flags) is the first step toward removability.

---

## The Deprecation Decision

Before deprecating anything, answer:

```
1. Does this system still provide unique value?
   → If yes, maintain it. If no, proceed.

2. How many consumers depend on it?
   → Quantify migration scope. Use graph-navigator to find consumers.

3. Does a replacement exist?
   → If no, build the replacement first. Don't deprecate without an alternative.

4. What's the migration cost per consumer?
   → If trivially automated, do it. If high-effort, weigh against maintenance cost.

5. What's the ongoing maintenance cost of NOT deprecating?
   → Security risk, agent/engineer time, complexity tax.
```

Capture the answers in an **ADR** (`documentation-and-adrs` skill) before announcing.

---

## Compulsory vs Advisory Deprecation

| Type | When to Use | Mechanism |
|------|-------------|-----------|
| **Advisory** | Migration is optional, old system stable | Warnings, docs, nudges. Users migrate on their own timeline. |
| **Compulsory** | Old system has security issues, blocks progress, or maintenance cost is unsustainable | Hard deadline. Old system removed by date X. **Migration tooling required.** |

**Default to advisory.** Use compulsory only when maintenance cost or risk justifies forcing migration. Compulsory deprecation requires migration tooling, documentation, and support — you can't just announce a deadline.

---

## The Migration Process

### Step 1 — Build the Replacement

Don't deprecate without a working alternative. The replacement must:

- Cover all critical use cases of the old system
- Have documentation and a migration guide
- Be proven in production (not theoretically better)
- Have ≥1 production consumer who has switched and reports success

### Step 2 — Announce and Document

```markdown
## Deprecation Notice: OldRiskService

**Status:** Deprecated as of 2026-03-01
**Replacement:** NewRiskService (see migration guide below)
**Removal date:** Advisory — no hard deadline yet (or: Compulsory by 2026-09-01)
**Reason:** OldRiskService has unbounded list endpoints (perf-optimization §unbounded)
            and lacks audit-trail coverage required by compliance (see ADR-0042).

### Migration Guide
1. Replace `import { riskService } from '../old-risk-service'` with
   `import { riskService } from '../risk-service'`
2. Method signatures changed — see table below
3. Run `npm run migrate:risks-v2` to update seed data
4. Run `npx vitest run` to verify
```

This goes in `docs/decisions/` (as the ADR) AND in the deprecated module's JSDoc:

```typescript
/**
 * @deprecated Use NewRiskService instead. This will be removed by 2026-09-01.
 * See ADR-0042 for the migration guide.
 */
export class OldRiskService { /* ... */ }
```

TypeScript surfaces `@deprecated` in IDEs and the agent will see it.

### Step 3 — Migrate Incrementally

Migrate consumers one at a time, not all at once. For each consumer:

```
1. Identify all touchpoints (graph-navigator: who imports old service?)
2. Update to use the replacement
3. Verify behavior matches (existing tests + behavioral equivalence test)
4. Remove references to the old system
5. Confirm no regressions (full vitest suite)
```

**The Churn Rule:** If you own the system being deprecated, **you are responsible for migrating consumers** — or providing backward-compatible updates that require no migration. Don't announce deprecation and walk away.

### Step 4 — Remove the Old System

Only after **zero active consumers** confirmed:

```
1. Verify zero usage:
   - graph-navigator: no imports of the old module
   - grep across src/: no string references
   - logs/metrics: no traffic to the old endpoint over a meaningful window
2. Remove the code
3. Remove associated tests, docs, configuration
4. Remove the deprecation notices
5. Remove the ADR cross-reference (mark ADR Status: Completed)
6. Celebrate — removing code is an achievement
```

---

## Migration Patterns

### Strangler Fig

Run old and new in parallel. Route traffic incrementally from old to new. When old handles 0%, remove it.

```
Phase 1: New 0%, old 100% (replacement built and shadow-tested)
Phase 2: New 10% (canary org or feature-flag rollout)
Phase 3: New 50%
Phase 4: New 100%, old idle
Phase 5: Remove old
```

Use existing project feature flags (`src/shared/src/config/feature-flags.ts`) plus per-org rollout for safe progression.

### Adapter

Create an adapter that translates old-interface calls to the new implementation. Consumers keep the old interface while you migrate the backend.

```typescript
// src/backend/src/modules/risks/legacy-risk-adapter.ts
// Adapter: presents the old interface, calls the new service.
// @deprecated Direct callers should migrate to riskService. See ADR-0042.
export class LegacyRiskService implements OldRiskAPI {
  constructor(private newService: RiskService) {}

  async getRisk(id: number, orgId: string): Promise<OldRisk> {
    const risk = await this.newService.findById(orgId, String(id));
    return this.toOldFormat(risk);
  }
}
```

### Feature Flag Migration

Switch consumers from old to new one at a time:

```typescript
import { FEATURE_FLAGS } from '@shared/config/feature-flags';

export function getRiskService(): RiskService {
  if (FEATURE_FLAGS.NEW_RISK_SERVICE) {
    return new NewRiskService();
  }
  return new LegacyRiskService();
}
```

Combine with per-org gating for canary rollouts.

---

## Zombie Code

Zombie code is code that nobody owns but everybody depends on. Signs:

- No commits in 6+ months but active consumers exist
- No assigned maintainer or sub-agent owner
- Failing tests that nobody fixes
- Dependencies with known vulnerabilities that nobody updates
- Documentation referencing systems that no longer exist
- "Why is this here?" produces shrugs

**Response:** Either assign an owner sub-agent in `SUB-AGENTS.md` and maintain it properly, OR deprecate it with a concrete migration plan and ADR. Zombie code cannot stay in limbo.

`graph-navigator` can identify zombie clusters: modules with import edges to nothing the team is actively maintaining.

---

## Project-Specific Deprecation Coordination

When deprecating something in this codebase, coordinate with:

| Surface deprecated | Coordinate with |
|--------------------|-----------------|
| Backend service or module | Test Specialist (rewrite tests against new), Build Integrity (verify no broken imports), Documentation Specialist (ADR + release notes) |
| API endpoint | API Specialist (contract migration), Frontend Specialist (consumer migration), Documentation Specialist (api-contracts.md) |
| Frontend component | Frontend Specialist (replace consumers), Test Specialist (component test rewrite), Accessibility Specialist (WCAG re-audit on replacement), I18N Specialist (locale-key cleanup) |
| Permission / role | Security Specialist (RBAC matrix), seed-roles.ts owner |
| i18n keys | I18N Specialist (clean across 16 locales), Test Specialist (mock cleanup) |
| Domain-specific system | Domain Specialist + User Validation Specialist |

---

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "It still works, why remove it?" | Working code that nobody maintains accumulates security debt and complexity. Maintenance cost grows silently. |
| "Someone might need it later" | If needed later, rebuild it. Keeping unused code "just in case" costs more than rebuilding. |
| "The migration is too expensive" | Compare migration cost to ongoing maintenance over 2-3 years. Migration is usually cheaper long-term. |
| "We'll deprecate it after we finish the new system" | Deprecation planning starts at design time. By the time the new system ships, you'll have new priorities. |
| "Users will migrate on their own" | They won't. Provide tooling and docs — or do the migration yourself (Churn Rule). |
| "We can maintain both indefinitely" | Two systems doing the same thing = double the maintenance, testing, docs, onboarding. |

---

## Red Flags

- Deprecated systems with no replacement available
- Deprecation announcements with no migration tooling or docs
- "Soft" deprecation that's been advisory for years with no progress
- Zombie code with no owner and active consumers
- New features added to a deprecated system (invest in the replacement instead)
- Deprecation without measuring current usage (logs, graph-navigator)
- Removing code without verifying zero active consumers
- No ADR documenting why the deprecation was chosen

---

## Input Schema

```yaml
input:
  target:
    type: object
    required: true
    properties:
      surface:
        type: enum
        values: [backend-service, backend-route, frontend-component, frontend-page, shared-type, permission, i18n-key-namespace, dependency, infrastructure-component]
      identifier: { type: string, description: "File path, module slug, route pattern, or permission name" }
  replacement:
    type: object
    required: false
    description: "Required unless deprecating without replacement (which usually means full removal)"
    properties:
      identifier: { type: string }
      production_proven: { type: boolean }
  deprecation_type:
    type: enum
    values: [advisory, compulsory]
    required: true
  reason:
    type: string
    required: true
    description: "Specific maintenance/security/perf/compliance driver"
  removal_target_date:
    type: string
    required: false
    description: "ISO date for compulsory deprecation; omit for advisory"
```

## Output Schema

```yaml
output:
  adr:
    type: object
    properties:
      number: { type: integer }
      path: { type: string }
      status:
        type: enum
        values: [Proposed, Accepted]
  consumers_identified:
    type: array
    description: "Result of graph-navigator + grep sweep"
    items:
      type: object
      properties:
        path: { type: string }
        consumer_type: { type: string, description: "import, route, component-usage, etc." }
        migration_complexity: { type: enum, values: [trivial, automated, manual] }
  migration_artifacts:
    type: array
    items:
      type: object
      properties:
        type:
          type: enum
          values: [adapter, feature-flag, migration-script, jsdoc-deprecated-tag, deprecation-notice-doc]
        path: { type: string }
  coordination:
    type: array
    items:
      type: object
      properties:
        agent: { type: string }
        reason: { type: string }
  removal_readiness:
    type: object
    description: "Populated when running Step 4 — Remove"
    properties:
      consumers_remaining: { type: integer }
      tests_referencing: { type: integer }
      docs_referencing: { type: integer }
      log_traffic_observed: { type: boolean }
      safe_to_remove: { type: boolean }
```

## Quality Gate

- An ADR exists capturing reason, alternatives, decision, consequences
- A working replacement exists and has at least one production consumer (or removal is unconditional dead-code cleanup)
- Migration guide is published — concrete steps, not "see source"
- All consumers identified via graph-navigator + grep — no consumer-discovery gaps
- `@deprecated` JSDoc tag on the deprecated symbols (TypeScript surfaces it to agents and IDEs)
- Coordination triggers honored — relevant specialist agents notified
- For compulsory deprecation: removal target date set AND migration tooling delivered before announcement
- Removal step blocked until consumers_remaining = 0 AND no recent log traffic
- Old code, tests, docs, configuration, AND deprecation notices removed in the final step (no stale notices)
- ADR Status updated to "Accepted" → "Completed" once removal lands

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "deprecation-and-migration"
  stage: "S2"
  suggested_next:
    - slug: "documentation-and-adrs"
      stage: "S5"
      reason: "Capture the deprecation decision in an ADR before announcing"
    - slug: "codebase-graph-navigation"
      stage: "S1"
      reason: "Identify all consumers before announcing migration"
    - slug: "incremental-implementation"
      stage: "S1"
      reason: "Migrate consumers one slice at a time using strangler / feature-flag pattern"
    - slug: "release-notes"
      stage: "S5"
      reason: "Communicate deprecation in user-facing release notes"
    - slug: "doc-housekeeping"
      stage: "S5"
      reason: "Update the 9 mandatory docs to reflect the deprecation and final removal"
```

## Error Handling

- If a replacement does not exist, do NOT announce deprecation — build the replacement first
- If consumer count is unknown (graph-navigator unavailable for the surface), do a grep sweep AND a log review before declaring "ready to remove"
- If compulsory deprecation is requested without migration tooling, downgrade to advisory until tooling exists
- If a consumer's migration is high-effort and the consumer is critical, the deprecating team owns the migration (Churn Rule) — do not push the work to the consumer
- If removal would leave dangling references in tests, docs, or seed data, those count as consumers — clean them in the same PR
- If the system being deprecated is domain-sensitive (e.g., audit-trail emitters), require Domain Specialist sign-off before removal — record in the ADR
- If you discover the "old" system is actually the only one with a behavior the new one missed (Hyrum's Law), pause the migration — extend the new system OR document the behavioral gap as accepted before continuing
