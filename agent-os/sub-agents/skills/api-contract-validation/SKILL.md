Title: API Contract Validation
Keywords: api, contract, validation, request, response, endpoint, payload, frontend-backend
Agents: api, backend, frontend
When to use: When validating that frontend API client methods, backend route handlers, and backend service methods agree on request/response shapes.
Version: 1.0.0
Last updated: 2026-03-16

Validate API contracts end-to-end. Frontend request payloads must match backend service expectations. Error response format must be consistent. Query parameters must be documented. Trace: frontend API client method -> backend route handler -> backend service method. Catch mismatches before they reach production.

---

## Workflow

### Step 1 — Identify the API Contract Chain

For each endpoint, trace three layers:

```
Frontend API client method
  → HTTP request (method, path, body, query params)
    → Backend route handler (param extraction, validation)
      → Backend service method (business logic, DB operations)
        → Response shape
      → Error response shape
```

### Step 2 — Verify Frontend API Client

Read `src/frontend/src/services/api-client.ts` and check:

```typescript
// Expected pattern:
async listExamples(filters?: Record<string, string>) {
  const params = new URLSearchParams(filters);
  const res = await this.get(`/api/v1/examples?${params}`);
  return res.json();
}

async createExample(data: CreateExampleInput) {
  const res = await this.post('/api/v1/examples', data);
  return res.json();
}
```

Verify:
- HTTP method matches the route definition (GET, POST, PUT, PATCH, DELETE)
- URL path matches the route mount point in `app.ts`
- Request body shape matches what the route handler extracts
- Query parameters match what the route handler reads

### Step 3 — Verify Backend Route Handler

Read `src/backend/src/modules/<module>/routes.ts` and check:

```typescript
// Expected pattern:
router.post(
  '/',
  requirePermission(Permission.EXAMPLES_WRITE) as any,
  async (req, res, next) => {
    try {
      const s = (req as AuthenticatedRequest).session;
      const result = await exampleService.create(s.org_id, req.body, s.user_id);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);
```

Verify:
- `requirePermission` guard is present on every endpoint
- Session extraction: `(req as AuthenticatedRequest).session`
- Service call passes `s.org_id` as first argument
- Request body is passed as-is or with explicit field extraction
- Response status code is correct (200 for GET, 201 for POST, etc.)

### Step 4 — Verify Backend Service Method

Read `src/backend/src/modules/<module>/*-service.ts` and check:

- Method signature matches what the route passes
- Return shape matches what the frontend expects
- Error codes match what the frontend handles

### Step 5 — Check Common Mismatches

> **Phase 17/19 postmortem:** These mismatches occurred in 21 of 21 modules. See `memories/engineering-phase17-postmortem.md` for the full failure analysis.

| Mismatch type | Example | How to detect | Phase 17 frequency |
|--------------|---------|---------------|-------------------|
| Field name | Frontend sends `{ comment: text }`, backend expects `{ text: text }` | Compare `req.body` usage in route with field access in service | 12+ modules |
| Status values | Backend stores `in_review`, frontend checks `under_review` | Grep for status string in both frontend and backend | 3+ modules |
| Response shape | Service returns `{ items, count }`, frontend expects `{ data, total }` | Compare service return with API client destructuring | 6 modules |
| HTTP method | Frontend uses PUT, route is defined as PATCH | Compare API client method with route definition | 2 modules |
| URL path | Frontend calls `/api/v1/task`, route mounted at `/api/v1/tasks` | Compare API client URL with app.ts mount | **15+ modules** |
| URL sub-path | Frontend calls `/module/access-policies`, route defines `/policies` | Compare API client sub-path with route handler path | **15+ modules** |
| Query vs path params | Frontend sends `?incident_id=X`, route expects `/:incidentId` | Compare URL construction with route parameter style | 3 modules |
| Missing pagination unwrap | Frontend treats `{ data, total, page, page_size }` as array | Check if frontend does `res.data` or uses `res` directly | **6 modules** |
| Missing form fields | Backend validates `if (!data.X)` but frontend form has no input for X | Compare backend validation block with frontend form state | **10+ modules** |
| Enum value mismatch | Frontend sends `package_type: 'access_review'`, backend expects `export_type: 'full'` | Compare frontend form options with backend validation array | 3 modules |
| Free-text instead of selector | Frontend uses `<input type="text">` for entity reference IDs | Check if `*_id` or `*_code` fields use `<select>` vs `<input>` | **18+ modules** |
| Missing CRUD endpoints | Frontend has create UI but backend has no GET list endpoint | Verify all 4 CRUD operations exist in routes.ts | 3+ modules |

### Step 6 — Verify Error Response Format

All errors must follow the AppError format:

```json
{
  "error": {
    "status": 400,
    "code": "VALIDATION_ERROR",
    "message": "Missing required field: name"
  }
}
```

Check that:
- Frontend error handlers read `err.response.error.message` or similar
- Backend always throws `AppError` (never raw `Error`)
- Error codes are consistent (e.g., `*_NOT_FOUND`, `*_ALREADY_EXISTS`, `VALIDATION_ERROR`)

### Step 7 — Verify Query Parameters

For list endpoints, check that all supported filters are:
1. Accepted by the route handler
2. Passed to the service method
3. Applied in the MongoDB query
4. Exposed in the frontend filter UI

## End-to-End Validation Checklist

### Request contract
- [ ] HTTP method matches (GET/POST/PUT/PATCH/DELETE)
- [ ] URL path matches route mount in `app.ts` **AND** sub-path in `routes.ts` (do NOT guess from module name)
- [ ] Request body field names match between frontend form state and backend service parameter destructuring
- [ ] Query parameter names match between frontend and backend (query params vs path params)
- [ ] Content-Type header is set correctly

### Response contract
- [ ] Success response shape matches frontend expectations
- [ ] Pagination shape is `{ data, total, page, page_size }` — frontend unwraps with `response.data` (NOT `Array.isArray(response)`)
- [ ] Error response follows AppError format
- [ ] Frontend error handlers parse AppError message (NOT generic `t.common.error` only)
- [ ] Status codes are correct (200, 201, 204, 400, 404, 409)

### Security contract
- [ ] Every endpoint has `requirePermission` guard
- [ ] Permission constant exists in `permissions.ts`
- [ ] Frontend checks permission before showing UI elements
- [ ] `org_id` scoping enforced on every service call

### Data contract
- [ ] Field names are consistent: seed data -> service -> API response -> frontend render
- [ ] Status string values match across all layers
- [ ] Date formats are consistent (ISO strings)
- [ ] ID field names match (`example_id` not `exampleId`)

### Form contract (added Phase 20 — Sprint 25.3.0 postmortem)
- [ ] Every backend-validated required field has a corresponding frontend form input
- [ ] Entity reference fields (`*_id`, `*_code`, `*_ids`) use dropdown/select, NOT free-text input
- [ ] Enum fields use `<select>` with options matching backend validation array
- [ ] Array fields (e.g., `reviewer_ids: string[]`) use multi-select, NOT comma-separated text
- [ ] Form submission button has loading/disabled state during async operation

### Endpoint coverage (added Phase 20 — Sprint 25.3.0 postmortem)
- [ ] GET list endpoint exists for every view that shows a table/list
- [ ] GET by-id endpoint exists if detail view is needed
- [ ] POST create endpoint exists if form allows creation
- [ ] PUT/PATCH update endpoint exists if edit UI is present
- [ ] DELETE endpoint exists if delete button is present

## Quick Verification Commands

```
# Find API client method
Grep: pattern="listExamples|createExample|updateExample", path="src/frontend/src/services/api-client.ts"

# Find route handler
Grep: pattern="router\.(get|post|put|patch|delete)", path="src/backend/src/modules/examples/routes.ts"

# Find service method
Grep: pattern="async (create|list|update|delete|getById)", path="src/backend/src/modules/examples/"

# Find where route is mounted
Grep: pattern="examples", path="src/backend/src/app.ts"

# Find frontend usage of API response fields
Grep: pattern="item\.\w+", path="src/frontend/src/pages/admin/examples/"
```

## Input Schema

```yaml
inputs:
  module_name:
    type: string
    required: true
    description: "Module to validate (e.g., 'tasks', 'vendors'). Used to locate frontend API client methods, backend routes, and service files."
  endpoints:
    type: array
    required: false
    description: "Specific endpoints to validate (e.g., ['POST /api/v1/tasks', 'GET /api/v1/tasks']). If omitted, all endpoints for the module are validated."
  frontend_api_client_path:
    type: file_path
    required: false
    default: "src/frontend/src/services/api-client.ts"
    description: "Path to the frontend API client file."
  backend_routes_path:
    type: file_path
    required: false
    description: "Path to the backend routes file. Defaults to src/backend/src/modules/<module_name>/routes.ts."
```

## Output Schema

```yaml
outputs:
  validation_result:
    type: enum
    values: ["pass", "fail"]
    description: "Overall validation result across all checked endpoints"
  mismatches:
    type: array
    description: "List of detected mismatches, each with type, location, expected value, and actual value"
  endpoints_checked:
    type: integer
    description: "Number of endpoints validated"
  checklist_status:
    type: object
    description: "Per-section pass/fail for request, response, security, data, form, and endpoint coverage contracts"
```

## Quality Gate

- All endpoints for the module have been traced through all three layers (frontend API client, backend route handler, backend service method).
- Zero field-name mismatches between frontend request body and backend service parameter destructuring.
- URL paths in the frontend API client exactly match the route mount in `app.ts` combined with the sub-path in `routes.ts`.
- Every endpoint has a `requirePermission` guard and the corresponding permission constant exists in `permissions.ts`.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "api-contract-validation"
  stage: "S1"
  suggested_next:
    - slug: "test-patterns"
      stage: "S1"
      reason: "Write or update tests to cover any contract mismatches found during validation"
    - slug: "component-pattern"
      stage: "S1"
      reason: "If frontend mismatches were found, fix the component to align with the validated contract"
    - slug: "service-pattern"
      stage: "S1"
      reason: "If backend mismatches were found, fix the service to align with the validated contract"
```

## Error Handling

- If the frontend API client file does not contain methods for the specified module, report it as a missing-endpoint finding rather than failing silently.
- If the backend routes file or service file does not exist, report the missing layer and skip validation for that endpoint.
- If `app.ts` does not mount a route for the module, flag it as a critical mismatch (route exists but is not wired).
- If multiple route files define overlapping paths, flag the ambiguity and list all conflicting definitions.
