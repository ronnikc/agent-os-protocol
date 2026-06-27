Title: Test Patterns
Keywords: test, vitest, mock, factory, zod, coverage, backend, frontend, testing
Agents: test, backend, frontend
When to use: When writing tests for backend services or frontend components, or reviewing test files for pattern compliance.
Version: 1.0.0
Last updated: 2026-03-22

Test implementation patterns for this project. Mock pattern: vi.fn() with exact method names from real class. Factory functions for test data with Zod validation. Never weaken security to make tests pass. Backend services: mock db methods. Frontend components: mock API client, render with test providers. Includes code templates for both.

---

## Mandatory: Route Response String Changes Require Test Updates

> **Added 2026-03-15 after Incident 14 (5 test failures in CI).**

When modifying backend route response messages (e.g., changing `'System archived'` to `'system_archived'`), you MUST:

1. **Search for the old string in test files:**
   ```bash
   grep -rn "old_message_string" the backend modules
   ```
2. **Update every test assertion** that matches the old string
3. **Run vitest** on the affected test file to verify:
   ```bash
   npx vitest run the backend modules
   ```
4. **Report test results** in your return output — "tsc passes" is NOT sufficient for route changes

This applies to ALL response message changes: error messages, success messages, validation messages, and status messages. The test file assertions are a contract with the route — changing one without the other is always a bug.

---

## Mandatory: API Response Shape Changes Require Mock Updates

> **Added 2026-03-22 after Sprint 26.6.2 (38 test failures from typed api-client).**

When changing api-client method return types (e.g., adding `PaginatedResponse<T>` or `SingleResponse<T>` wrappers), you MUST update all test mocks for those methods:

1. **Search for mock patterns:**
   ```bash
   grep -rn "methodName.*mock" the frontend pages
   ```
2. **If the component does `res.data`**, wrap mock return values:
   - Before: `mockResolvedValue([item])`
   - After: `mockResolvedValue({ data: [item] })`
3. **If the component does `res.data` + `res.total`**, use full shape:
   - `mockResolvedValue({ data: [item], total: 1, page: 1, page_size: 25 })`
4. **Run vitest on affected test files** to verify

This also applies to CSS value changes (rgba → CSS vars) and parameter type changes (number → string for query params).

---

## Backend Service Test Template

```typescript
// Copyright (c) 2026 Gothard.dk All rights reserved.
// This source code is proprietary and confidential.
// See LICENSE.md for licensing terms.

import { describe, it, expect, beforeEach } from 'vitest';
import { ExampleService } from '../example-service.js';
import { createMockDb, type MockDb } from '../../../test-utils/mock-db.js';

describe('ExampleService', () => {
  let db: MockDb;
  let service: ExampleService;

  beforeEach(() => {
    db = createMockDb();
    service = new ExampleService(db as any);
  });

  describe('create', () => {
    it('should create an example with valid data', async () => {
      const result = await service.create('org1', { name: 'Test' }, 'user1');
      expect(result.name).toBe('Test');
      expect(result.org_id).toBe('org1');
      expect(result.created_by).toBe('user1');
      expect(result.example_id).toBeDefined();
    });

    it('should throw VALIDATION_ERROR when name is missing', async () => {
      await expect(
        service.create('org1', { name: '' }, 'user1'),
      ).rejects.toThrow('name');
    });

    it('should throw ALREADY_EXISTS for duplicates', async () => {
      const col = db._collections['grc_examples'];
      col._store.push({ _id: '1', org_id: 'org1', name: 'Test' });
      await expect(
        service.create('org1', { name: 'Test' }, 'user1'),
      ).rejects.toThrow('already');
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      const col = db._collections['grc_examples'];
      col._store.push(
        { _id: '1', org_id: 'org1', name: 'A', created_at: '2024-01-01' },
        { _id: '2', org_id: 'org1', name: 'B', created_at: '2024-01-02' },
      );
      const result = await service.list('org1', 1, 20);
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.page_size).toBe(20);
    });
  });

  describe('getById', () => {
    it('should return item when found', async () => {
      const col = db._collections['grc_examples'];
      col._store.push({ _id: '1', org_id: 'org1', example_id: 'ex1', name: 'Test' });
      const result = await service.getById('org1', 'ex1');
      expect(result.name).toBe('Test');
    });

    it('should throw NOT_FOUND when missing', async () => {
      await expect(service.getById('org1', 'missing')).rejects.toThrow('not found');
    });
  });

  describe('delete', () => {
    it('should delete an existing item', async () => {
      const col = db._collections['grc_examples'];
      col._store.push({ _id: '1', org_id: 'org1', example_id: 'ex1', name: 'Test' });
      await service.delete('org1', 'ex1', 'user1');
      // Verify audit event was logged
      const auditCol = db._collections['grc_example_audit_events'];
      expect(auditCol._store).toHaveLength(1);
      expect(auditCol._store[0].action).toBe('deleted');
    });
  });
});
```

## Frontend Component Test Template

```typescript
// Copyright (c) 2026 Gothard.dk All rights reserved.
// This source code is proprietary and confidential.
// See LICENSE.md for licensing terms.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExamplesPage } from '../ExamplesPage.js';
import shared from '../../../../locales/en/common.json';

// Mock API client — method names MUST match real apiClient methods
vi.mock('../../../../services/api-client.js', () => ({
  apiClient: {
    listExamples: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, page_size: 20 }),
    createExample: vi.fn().mockResolvedValue({}),
    updateExample: vi.fn().mockResolvedValue({}),
    deleteExample: vi.fn().mockResolvedValue({}),
  },
}));

// Mock useLocale — always return shared.en translations
vi.mock('../../../../hooks/useLocale.js', () => ({
  useLocale: () => ({ t: shared, locale: 'en' }),
}));

// Mock useToast
vi.mock('../../../../components/Toast.js', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// Mock useAnnounce
vi.mock('../../../../hooks/useAnnounce.js', () => ({
  useAnnounce: () => ({ announce: vi.fn() }),
}));

// Mock usePageTitle
vi.mock('../../../../hooks/usePageTitle.js', () => ({
  usePageTitle: vi.fn(),
}));

describe('ExamplesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the page title', async () => {
    render(<ExamplesPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
  });

  it('should fetch and display items on mount', async () => {
    const { apiClient } = await import('../../../../services/api-client.js');
    (apiClient.listExamples as any).mockResolvedValueOnce({
      data: [{ _id: '1', name: 'Test Item', status: 'active' }],
      total: 1,
      page: 1,
      page_size: 20,
    });

    render(<ExamplesPage />);
    await waitFor(() => {
      expect(screen.getByText('Test Item')).toBeInTheDocument();
    });
  });
});
```

## Key Rules

### Mock Method Names Must Match Reality

Mock method names must exactly match the real API client method names. Wrong names pass vitest but fail `tsc --noEmit`.

```typescript
// WRONG — will pass vitest but fail type-check
apiClient: { getExamples: vi.fn() }

// RIGHT — matches real method name
apiClient: { listExamples: vi.fn() }
```

### Use createMockDb for Backend Tests

Always use the shared `createMockDb` utility from the backend. This provides an in-memory mock with `_collections` and `_store` arrays.

```typescript
import { createMockDb, type MockDb } from '../../../test-utils/mock-db.js';

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
});
```

To pre-populate data, push directly to the collection store:

```typescript
const col = db._collections['grc_examples'];
col._store.push({ _id: '1', org_id: 'org1', name: 'Test' });
```

### Use Existing Test Factories

Use `createTestSession()`, `mockRequest()`, `mockResponse()`, `createTestUser()`, `createTestVendor()`, `createTestCase()` from test utilities. Do not create ad-hoc test data.

### Never Weaken Security for Tests

- Do not skip `requirePermission` middleware in tests
- Do not bypass authentication to simplify test setup
- Do not use `any` to silence security-related type errors in tests
- If a test requires auth context, use `createTestSession()` to provide it

### Audit Event Verification

For state-changing operations, verify that audit events were logged:

```typescript
const auditCol = db._collections['grc_example_audit_events'];
expect(auditCol._store).toHaveLength(1);
expect(auditCol._store[0].action).toBe('created');
expect(auditCol._store[0].org_id).toBe('org1');
```

### Frontend Test Providers

When components require context providers (Router, Theme, etc.), wrap in the appropriate test provider. Check existing tests for the pattern used.

### Drag Event Testing in jsdom

jsdom does not provide `dataTransfer` on DragEvent. Always supply a mock:

```typescript
const dataTransfer = { setData: vi.fn(), getData: vi.fn() };
fireEvent.dragStart(element, { dataTransfer });
fireEvent.drop(target, { dataTransfer });
```

### Coverage Exclusions for Static Data

Pure data files (i18n translations, seed data) should be excluded from coverage via `vitest.config.ts` `coverage.exclude` patterns. These are non-testable literals that inflate the denominator.

### Zod Validation in Tests

When testing input validation, use Zod schemas to generate valid/invalid test data:

```typescript
import { z } from 'zod';

const validInput = ExampleSchema.parse({ name: 'Test', status: 'active' });
const invalidInput = { name: '', status: 'invalid' }; // should fail validation
```

### vi.fn() Type Assignability in Strict TypeScript (Sprint 18.6.0)

When a component prop expects a typed callback (e.g., `(rules: EscalationRule[]) => void`), passing `vi.fn()` directly causes a TS error because `vi.fn()` returns `Mock<any>` which doesn't match the specific function type. Use `as any` on the prop:

```tsx
let onChange: ReturnType<typeof vi.fn>;
onChange = vi.fn();
render(<WorkflowEditor rules={[]} onChange={onChange as any} />);
```

### Vitest V8 Coverage Concurrency (Sprint 18.6.0)

When running tests with V8 coverage provider and encountering `ENOENT: coverage-N.json` errors, use `--maxConcurrency=1` to serialize coverage file writes. This is a known race condition in the V8 coverage provider.

### Frontend Tests Must Run from the frontend (Sprint 20.2.0)

The root `vitest.config.ts` only includes backend and shared test paths. Frontend tests are NOT discovered when running `npx vitest` from the repo root. Always run frontend tests from the frontend directory:

```bash
cd the frontend && npx vitest run src/pages/admin/...
```

Or specify the config explicitly:
```bash
npx vitest run --config the frontendvitest.config.ts the frontend pages
```

### Mock DB Does Not Support $elemMatch (Sprint 20.5.0)

The `createMockDb` utility's `matchesFilter` function does not support MongoDB's `$elemMatch` operator. Tests using `$elemMatch` in queries will fail silently (return empty results) or throw errors.

**Workaround:** For services that use `$elemMatch` in their queries, mock the entire find chain directly instead of relying on the in-memory store:

```typescript
// DON'T rely on matchesFilter for $elemMatch
const col = db._collections['grc_examples'];
col._store.push({ _id: '1', tags: [{ name: 'security', level: 'high' }] });
// This WON'T work: service.findByTag({ tags: { $elemMatch: { name: 'security' } } })

// DO mock the find chain directly
const mockFind = vi.fn().mockReturnValue({
  sort: vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue([{ _id: '1', tags: [{ name: 'security', level: 'high' }] }]),
  }),
});
```

## Checklist

- [ ] `beforeEach` resets mocks and creates fresh db/service instances
- [ ] Mock method names match real class method names exactly
- [ ] At least one test per public method
- [ ] Happy path + error path tested for each method
- [ ] Validation errors tested (missing fields, invalid data)
- [ ] Not-found errors tested
- [ ] Duplicate/conflict errors tested where applicable
- [ ] Audit events verified for state-changing operations
- [ ] No security weakening (no skipped auth, no bypassed RBAC)
- [ ] Tests pass both vitest and `tsc --noEmit`
- [ ] Mock objects include ALL required fields from shared type definitions (don't skip optional fields that components read)
- [ ] Frontend widget mocks match the ACTUAL backend service response shape (read the backend service file, not assumptions)
- [ ] When sub-agents write frontend tests, the prompt MUST include the backend service file path so mock data matches real return types
- [ ] After sub-agent completes, run `tsc --noEmit` before committing — never trust agent-generated i18n key references (Sprint 21.1.0 lesson: 20+ TS errors from unverified agent output)
- [ ] Use `String(doc._id)` when passing MongoDB ObjectId values to string-typed parameters — this is the standard pattern in every service (recurring since Sprint 20.2.0)
- [ ] Module maturity sprint tests: aim for ~40+ backend tests per service, 4-5 frontend tests per page (title, data loading, empty state, action, error)
- [ ] For session recovery: use `git stash && tsc --noEmit && git stash pop` to distinguish pre-existing TS errors from new ones
- [ ] Backend sub-agent prompts MUST explicitly request test file creation with path and minimum test count — agents omit tests when not explicitly listed as a deliverable (Sprint 21.5.0 lesson: 43 tests written manually after agent skipped test file)
- [ ] After i18n agent completes, verify EN values match expected UI text — agent tends to use brief labels ("Create Review") instead of full descriptive text ("Create Security Review") (Sprint 21.6.0 lesson)
- [ ] Every vitest function used in the file MUST be imported — check for `vi` in the import when `vi.mock()` or `vi.fn()` is used (Sprint 22.4.0 lesson: missing `vi` import passed vitest hoisting but failed tsc)
- [ ] Before asserting any field on a result object, verify that field exists in the shared type definition (the shared types) — if the service writes it but the type doesn't declare it, add it to the type FIRST (Sprint 22.4.0 lesson: `created_by` in service but not in `DsrResponseTemplate`)
- [ ] MongoDB `_id` casts MUST use `as unknown as string` — never `as string` directly (ObjectId is not assignable to string)
- [ ] Express `req.params.*` MUST be narrowed with `as string` before passing to service methods (type is `string | string[]`)
- [ ] **Self-verification gate**: after writing test files, agent MUST run `tsc --noEmit` AND `vitest run [file]` — do NOT return until both pass with zero errors

## Input Schema

```yaml
inputs:
  test_target:
    type: string
    required: true
    description: "Path to the service or component file to test (e.g., 'the backend modules)."
  test_type:
    type: enum
    required: true
    values: ["backend_service", "frontend_component", "route_handler"]
    description: "Type of test to generate. Determines template, mock strategy, and assertion patterns."
  module_name:
    type: string
    required: true
    description: "Module name used to locate collections, API methods, and i18n keys."
  public_methods:
    type: array
    required: false
    description: "List of public method names to test. If omitted, all public methods on the class are tested."
```

## Output Schema

```yaml
outputs:
  test_file:
    type: file_path
    description: "Path to the created test file (e.g., the backend modules)"
  test_count:
    type: integer
    description: "Total number of test cases written"
  tsc_result:
    type: enum
    values: ["pass", "fail"]
    description: "Result of tsc --noEmit on the test file"
  vitest_result:
    type: enum
    values: ["pass", "fail"]
    description: "Result of vitest run on the test file"
```

## Quality Gate

- Every public method on the target class has at least one happy-path and one error-path test.
- Both `tsc --noEmit` and `vitest run <test_file>` pass with zero errors before the skill is considered complete.
- Mock method names exactly match the real class/API client method names (verified by tsc).
- Audit event assertions are present for all state-changing operations (create, update, delete).

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "test-patterns"
  stage: "S1"
  suggested_next:
    - slug: "api-contract-validation"
      stage: "S1"
      reason: "After tests pass, validate the full API contract end-to-end"
    - slug: "service-pattern"
      stage: "S1"
      reason: "If tests reveal service pattern deviations, fix the service first"
```

## Error Handling

- If the target file does not exist or has no public methods, report the error and do not generate an empty test file.
- If `createMockDb` does not support a MongoDB operator used by the service (e.g., `$elemMatch`), use direct find-chain mocking as documented in the Mock DB limitation section.
- If `tsc --noEmit` fails due to missing shared types, flag the missing type and suggest running the shared build first.
- If vitest fails with coverage concurrency errors (`ENOENT: coverage-N.json`), retry with `--maxConcurrency=1`.
