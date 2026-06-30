Title: Mock API Specification
Keywords: mock-api, mock-servers, msw-handlers, interceptors, testing-stubs
Agents: api, e2e-architect, test, crm-integration-engineer
When to use: When building mock servers, Mock Service Worker (MSW) handlers, and client-side interceptors to decouple frontend tests from live endpoints.
Version: 1.0.0
Last updated: 2026-06-30

Construct mock API handlers, mock server middleware, and interceptors to enable offline testing and decoupled frontend verification.

---

## Workflow

### Step 1 — Define Endpoint Payload Schema
Inspect the API spec document to identify the endpoint path, HTTP method, request headers, query parameters, and JSON response bodies.

### Step 2 — Construct Mock Handler
Write mock handler scripts:
- **MSW (Mock Service Worker):** Define request interceptors (`http.get('/api/users', () => HttpResponse.json(...))`).
- **Express Middleware:** Define custom test routes that send predictable JSON response templates and status codes.

### Step 3 — Integrate Mock Server
Import and load mock handlers inside the testing suite config (e.g. `setupFiles` in Vitest/Jest, or Cypress intercept rules). Ensure the mock configuration shuts down clean when test cycles complete.

### Step 4 — Verify Endpoint Mocking
Execute tests using the mock endpoints to verify that client requests receive the stub payloads correctly.

---

## Input Schema

```yaml
input:
  endpoint_path:
    type: string
    required: true
    description: "The API endpoint path to mock (e.g., /api/lobby/status)"
  method:
    type: enum
    values: [GET, POST, PUT, DELETE, PATCH]
    required: true
    description: "HTTP method of the target endpoint"
```

## Output Schema

```yaml
output:
  mock_status:
    type: object
    properties:
      handler_created: { type: boolean }
      mock_response_status: { type: integer }
  mock_payload:
    type: string
    description: "JSON response payload defined for the mock"
```

## Quality Gate

- Mock endpoints return valid JSON matching defined API specifications
- Mock servers shut down at the end of the test suite execution
- HTTP status codes are correctly configured on mock errors (e.g. 401, 500)

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "mock-api-specification"
  stage: "S1"
  suggested_next:
    - slug: "api-contract-validation"
      stage: "S1"
      reason: "Mock APIs should be validated against schemas before use in testing suites"
```

## Error Handling

- If the mock payload uses invalid JSON syntax, fail and return a JSON validation error.
- If mock requests leak through to live external networks, abort and check proxy configurations.
