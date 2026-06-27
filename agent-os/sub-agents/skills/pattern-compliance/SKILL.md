Title: Pattern Compliance
Keywords: code-review, checklist, patterns, imports, errors, rbac, audit, i18n, mocks, naming
Agents: code-review, backend, frontend
When to use: When reviewing code for compliance with established project patterns, or before marking a sprint task as complete.
Version: 1.0.0
Last updated: 2026-03-10

Code review checklist for this project. Check: imports follow convention, error handling uses AppError, RBAC on every endpoint, audit events on state changes, i18n via useLocale (no hardcoded strings), mocks match real signatures, field names consistent seed-to-frontend, no TODO/FIXME/HACK/XXX in sprint code.

---

## Review Checklist

Run through each section for every file in the changeset.

### 1. Import Conventions

| Pattern | Correct | Wrong |
|---------|---------|-------|
| AppError | `import { AppError } from '../../middleware/error-handler.js'` | `import AppError from ...` |
| API client | `import { apiClient } from '../../../services/api-client.js'` | `import apiClient from ...` (default import) |
| Locale hook | `import { useLocale } from '../../../hooks/useLocale.js'` | `import useLocale from ...` |
| File extensions | All imports end in `.js` | Missing extension or using `.ts`/`.tsx` |

```
# Verify: no default imports of apiClient
Grep: pattern="import apiClient from", path="the frontend"
# Should return 0 results

# Verify: all AppError imports use named import
Grep: pattern="import { AppError }", path="the backend"
```

### 2. Error Handling

- [ ] All errors use `AppError`: `new AppError(statusCode, 'ERROR_CODE', 'message')`
- [ ] Parameter order is `(status, code, message)` — NOT `(message, status)`
- [ ] Standard codes: `VALIDATION_ERROR` (400), `*_NOT_FOUND` (404), `*_ALREADY_EXISTS` (409)
- [ ] No raw `throw new Error()` in service or route files
- [ ] Route handlers wrap service calls in try/catch and call `next(err)`

```
# Find raw Error throws (should be 0 in service files)
Grep: pattern="throw new Error\(", path="the backend modules
```

### 3. RBAC on Every Endpoint

- [ ] Every route has `requirePermission(Permission.XXX) as any`
- [ ] Permission constant exists in the shared package
- [ ] Permission is seeded in the data layer
- [ ] Middleware chain: `router.use(authenticate as any, enforceOrgScope as any, adminRateLimiter)`

```
# Find routes without requirePermission
Grep: pattern="router\.(get|post|put|patch|delete)\([^)]*\n[^r]*(?!requirePermission)", path="the backend modules, multiline=true
```

### 4. Audit Events on State Changes

- [ ] `create` operations emit audit event with action `'created'`
- [ ] `update` operations emit audit event with action `'updated'` and before/after snapshots
- [ ] `delete` operations emit audit event with action `'deleted'`
- [ ] Status transitions emit audit event with action describing the transition
- [ ] Audit event shape: `{ _id, org_id, entity_type, entity_id, action, actor_id, timestamp, before, after }`

```
# Find service methods that don't call auditLog
Grep: pattern="async (create|update|delete)", path="the backend modules
# Then verify each method calls this.auditLog()
```

### 5. i18n via useLocale (No Hardcoded Strings)

- [ ] Every page component calls `const { t } = useLocale()`
- [ ] All visible text uses `t.*` keys — no hardcoded English or localized strings
- [ ] No `langKey` pattern (banned)
- [ ] No direct EN/VI conditional lookups (banned)
- [ ] i18n keys added to ALL multiple locales files
- [ ] Key paths follow `t.<module>.<element>` convention

```
# Find hardcoded strings in JSX (potential violations)
Grep: pattern=">[A-Z][a-z]+ [a-z]+<", path="the frontend pages

# Find langKey usage (banned)
Grep: pattern="langKey", path="the frontend"

# Find direct locale conditionals (banned)
Grep: pattern="locale.*===.*'en'|locale.*===.*'vi'", path="the frontend"
```

### 6. Mock Method Names Match Real Signatures

- [ ] Mock `apiClient` methods use exact method names from real `api-client.ts`
- [ ] Mock `vi.fn()` return values match real return shapes
- [ ] Tests pass both `vitest` and `tsc --noEmit`

```
# List all mocked apiClient methods
Grep: pattern="apiClient:\s*\{", path="the frontend pages, -A=20

# Compare with real methods
Grep: pattern="async \w+\(", path="the frontend
```

### 7. Field Name Consistency (Seed → Service → API → Frontend)

- [ ] Seed data field names match service `create()` output
- [ ] Service response field names match API client expectations
- [ ] Frontend renders fields that actually exist in the API response
- [ ] Status strings are identical across all layers

```
# Trace a field from seed to frontend
Grep: pattern="risk_level", path="the data layer
Grep: pattern="risk_level", path="the backend modules
Grep: pattern="risk_level", path="the frontend pages
```

### 8. No TODO/FIXME/HACK/XXX in Sprint Code

- [ ] No `TODO` comments in committed code
- [ ] No `FIXME` comments in committed code
- [ ] No `HACK` comments in committed code
- [ ] No `XXX` comments in committed code

```
Grep: pattern="TODO|FIXME|HACK|XXX", path="src/"
```

### 9. MongoDB Patterns

- [ ] Filter objects cast with `as any`
- [ ] `$set`/`$push` operations cast with `as any`
- [ ] `insertOne` input cast with `as any`
- [ ] `_id` uses `ulid()`
- [ ] Entity-specific IDs use `crypto.randomUUID()`

### 10. Frontend Component Patterns

- [ ] Named function export (not default)
- [ ] CSS classes use `dm-` for layout, `aos-` for components
- [ ] `usePageTitle()` called
- [ ] Semantic HTML (`<main>`, `<header>`, `<section>`, `<table>`)
- [ ] ARIA attributes on interactive elements
- [ ] `ScreenReaderOnly` for live regions

### 11. Express Route Patterns

- [ ] Middleware chain: `authenticate`, `enforceOrgScope`, `adminRateLimiter`
- [ ] Session extraction: `(req as AuthenticatedRequest).session`
- [ ] Service calls pass `s.org_id` as first argument
- [ ] `as any` on `requirePermission()` for Express type compat
- [ ] Pagination reads `page` and `page_size` from query with defaults

## Severity Levels

| Severity | Meaning | Action |
|----------|---------|--------|
| Blocker | Security hole (missing RBAC, missing auth) | Must fix before merge |
| Critical | Data integrity (wrong field names, missing audit) | Must fix before merge |
| Major | Pattern violation (wrong import, raw Error) | Should fix before merge |
| Minor | Style issue (CSS naming, comment format) | Fix if convenient |

## Quick Full-File Review

For a single file, run all relevant checks:

```
# Backend service file
Read: the backend modules
Check: AppError import, constructor pattern, org_id first param, auditLog calls, as any casts

# Frontend page file
Read: the frontend pages
Check: useLocale, apiClient named import, no hardcoded strings, semantic HTML, ARIA

# Test file
Read: the backend modules
Check: createMockDb, mock method names, beforeEach reset, audit verification
```

## Input Schema

```yaml
input:
  changeset_paths:
    type: array
    items: string
    required: true
    description: "List of file paths in the changeset to review for pattern compliance"
  review_scope:
    type: enum
    values: [full-checklist, imports-only, rbac-only, i18n-only, quick-scan]
    required: false
    default: full-checklist
    description: "Which sections of the review checklist to run"
  base_sha:
    type: string
    required: false
    description: "Git base SHA for diff-based review (if reviewing a specific commit range)"
  head_sha:
    type: string
    required: false
    description: "Git head SHA for diff-based review"
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
          values: [Blocker, Critical, Major, Minor]
        category:
          type: string
          description: "Which checklist section (e.g., 'Import Conventions', 'RBAC', 'Audit Events')"
        file:
          type: string
        line:
          type: integer
        description:
          type: string
        fix_suggestion:
          type: string
  summary:
    type: object
    properties:
      total_files_reviewed: { type: integer }
      blocker_count: { type: integer }
      critical_count: { type: integer }
      major_count: { type: integer }
      minor_count: { type: integer }
      passed: { type: boolean, description: "True if zero Blocker and zero Critical findings" }
```

## Quality Gate

- Zero Blocker-severity findings (missing RBAC, missing auth) in the changeset
- Zero Critical-severity findings (wrong field names, missing audit events) in the changeset
- All import conventions verified (named imports, .js extensions)
- No TODO/FIXME/HACK/XXX comments in sprint code

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "pattern-compliance"
  stage: "S3"
  suggested_next:
    - slug: "tdd-discipline"
      stage: "S3"
      reason: "If pattern issues are found, fixes should follow TDD discipline"
    - slug: "i18n-batch-processing"
      stage: "S4"
      reason: "If i18n violations are found, batch processing may be needed to add missing keys"
```

## Error Handling

- If a file in the changeset cannot be read (deleted or moved), skip it and note it in the review summary rather than failing the entire review
- If the review scope is narrowed (e.g., rbac-only) but a Blocker is detected outside the scope, report it anyway — Blockers are never silently skipped
- If mock method names cannot be verified because api-client.ts has changed in the same changeset, verify against the new version of api-client.ts
- If field name consistency cannot be traced end-to-end (seed to frontend), document the trace gap and flag for manual verification
