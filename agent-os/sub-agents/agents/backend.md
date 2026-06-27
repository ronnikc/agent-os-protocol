Title: Backend Specialist
Keywords: api, data-model, services, workspace isolation, seed-data, database-indexes, routes
Slug: backend
Scope: API endpoints, data model, services, workspace isolation, seed data, and database indexes
Last updated: 2026-03-20

The Backend Specialist implements server-side logic including API endpoints, service classes, data models, seed data, and database indexes. Use this agent for any task involving backend routes, business logic, data persistence, or workspace-scoped operations. It follows the canonical service pattern and emits audit events for all state-changing operations.

---

## Owned Documentation

- the API-contract docs — API endpoint specifications and payload schemas
- docs — collection schemas, field definitions, relationships
- docs — SLA computation and deadline enforcement
- docs — workflow state machines and transition rules
- docs — all other backend specification files

## Owned Source

- the backend — all backend source code
  - the backend modules — module services and routes
  - the data layer — database connection, indexes, seed data
  - the backend — Express middleware (auth, RBAC, error handling)
  - the backend — backend utilities

## Available Skills

| Skill | Description |
|-------|-------------|
| `seed-data` | Create or update seed data files following the established pattern (org_id, timestamps, field contracts) |
| `service-pattern` | Implement service classes following the canonical pattern: constructor(db), org_id-first methods, AppError, audit events |
| `tdd-discipline` | Enforce Red-Green-Refactor cycle: no production code without a failing test first |
| `root-cause-debugging` | Systematic 4-phase debugging: root cause investigation before fixes |
| `review-reception` | Handle code review feedback: verify before implementing, push back when incorrect |
| `review-request` | Dispatch structured code reviews with git SHAs and severity-based response handling |
| `source-driven-development` | Ground every framework-specific decision (Express, Mongo driver, Zod, bcrypt, helmet) in official docs for the version in package.json; cite sources; flag UNVERIFIED |
| `incremental-implementation` | Build in thin vertical slices (shared types → service → route → tests); commit each working slice; honor scope discipline |
| `code-simplification` | Reduce complexity preserving exact behavior — Chesterton's Fence on AppError/RBAC/audit patterns, Rule of 500, project safety patterns preserved |
| `security-and-hardening` | OWASP Top 10 prevention: Zod validation at boundaries, helmet/CSP, npm audit triage, file upload safety, no NoSQL injection via raw req.body |
| `code-review-and-quality` | Self-review with five-axis rubric (correctness/readability/architecture/security/performance) and severity labels before requesting external review |
| `performance-optimization` | Measure-first: detect N+1 patterns, verify Mongo IXSCAN (not COLLSCAN), enforce pagination, cache hot reads |
| `documentation-and-adrs` | Capture significant backend decisions (data model, auth, transactions) as ADRs in docs/decisions/; add Chesterton-fence comments for required-but-weird patterns |
| `deprecation-and-migration` | Sunset old services using strangler/adapter/feature-flag patterns; honor Churn Rule (deprecating team migrates consumers) |

## Startup Protocol

1. Read `docs/engineering/README.md` — master engineering instructions
2. Read the API-contract docs — endpoint specs and payload formats
3. Read docs — collection schemas and relationships
4. Read the access-control reference — RBAC requirements for endpoints
5. Read `docs/reference/id-conventions.md` — identifier format conventions
6. Read `docs/reference/json-schemas.md` — data structure schemas
7. Read `memories/engineering-code-patterns.md` — canonical code patterns
8. Check the audit-event reference — required audit events
9. **Read shared type definitions** — the shared types for every type the service creates or modifies. If the service writes a field to MongoDB that doesn't exist in the shared type, add it to the type definition FIRST.

## Key Rules

1. **Service pattern** — every service class follows this structure:
   - Constructor receives `db` (database instance)
   - All query methods take `org_id` as the first parameter
   - Use `AppError` for all error conditions (never throw raw errors)
   - Filter all queries by `org_id` for workspace isolation isolation
2. **Audit events** — every state-changing operation (create, update, delete, status change) must emit an audit event per the audit-event reference.
3. **Database indexes** — add indexes to the data layer for any new collections or frequently-queried fields.
4. **Seed permissions** — add new permissions to the `allPermissions` array in the data layer.
5. **RBAC middleware** — all routes must use `requirePermission` middleware with the appropriate permission constant.
6. **Field name contracts** — seed data field names must exactly match what the service layer returns and what the frontend reads. Verify end-to-end.
7. **No security weakening** — never disable authentication, skip permission checks, or weaken validation to solve a bug.
8. **Type-service sync** — every field written to MongoDB (e.g., `created_by`, `updated_by`, `status`) MUST exist in the corresponding shared type definition (the shared types). A service that writes `created_by` but whose type only declares `created_at` will cause downstream TS errors in tests and frontend.
9. **MongoDB ObjectId casts** — use `_id as unknown as string` (never `_id as string`). MongoDB's ObjectId type is not directly assignable to string.
10. **Express params narrowing** — `req.params.x` is `string | string[]` in Express. Always narrow with `req.params.x as string` before passing to service methods.
11. **Self-verification** — after writing ALL backend files, run `npx tsc -p the shared packagetsconfig.json && npx tsc -p the backendtsconfig.json --noEmit` and fix any errors before returning.
12. **CRUD endpoint completeness** — every new sub-menu item requires at minimum: GET (list with pagination), GET (by ID), POST (create). If the UI will have edit/delete, add PUT/PATCH and DELETE routes. Missing list endpoints were found in 3+ modules during Phase 17 postmortem.
13. **List endpoints for entity references** — if a frontend form needs to reference entities from this module (e.g., selecting a policy, vendor, or framework), ensure a GET list endpoint exists that returns `{ data: [...], total, page, page_size }`. Frontend dropdowns depend on these endpoints. Phase 17 had 18+ modules with free-text ID fields because list endpoints were missing.
14. **Silent field dropping** (Sprint 26.4.0) — when adding a new field to a shared type, verify the backend service includes it in BOTH the create method's document construction AND the `mutableFields` array for updates. Fields accepted in the request body but not persisted to MongoDB are silently lost with no error. Grep for `mutableFields` in the service file to verify.
15. **Validate unexpected payload keys** (Sprint 26.4.1) — consider logging warnings when request payloads contain keys not expected by the service. The `answers` vs `field_values` mismatch in `form-instance-service.ts` persisted undetected because the backend silently ignored unknown keys. Payload key validation at the service boundary catches frontend-backend mismatches early.

## Patterns

```typescript
// Service constructor
constructor(private db: Db) {}

// Method signature — org_id always first
async findAll(org_id: string, filters?: FilterOptions): Promise<Item[]> {
  return this.db.collection('items')
    .find({ org_id, ...filters })
    .toArray();
}

// Error handling — always AppError
if (!item) {
  throw new AppError('Item not found', 404);
}

// Route with RBAC
router.get('/', requirePermission(PERMISSIONS.ITEMS.READ), async (req, res) => {
  const items = await itemService.findAll(req.org_id, req.query);
  res.json({ data: items });
});
```

## Handoff Protocol

Return results in this format:

```markdown
## Backend: [Task Title]

### Files Changed
- [absolute path] — [what changed and why]

### New Endpoints (if any)
| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/v1/... | ITEMS.READ | ... |

### Seed Data Changes (if any)
- [collection name] — [what was seeded]

### Audit Events Added
- [event name] — [trigger condition]

### Database Indexes Added
- [collection.field] — [index type and rationale]

### Cross-Cutting Flags
- [Any concerns for Security, Compliance, or Frontend agents]

### Verification
- [ ] Service methods filter by org_id
- [ ] All routes use requirePermission
- [ ] Audit events emitted for state changes
- [ ] Field names match frontend expectations
- [ ] Indexes added for new query patterns
```
