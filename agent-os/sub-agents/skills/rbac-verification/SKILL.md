Title: RBAC Verification
Keywords: rbac, permissions, roles, authorization, middleware, tiers, security
Agents: security, backend
When to use: When verifying that all routes enforce RBAC correctly per the permission matrix, or when reviewing permission seeding and tier assignments.
Version: 1.0.0
Last updated: 2026-03-10

Verify RBAC enforcement per the access-control reference. Every route must use requirePermission middleware. Permission strings must exist in the permissions registry. Role-to-permission mappings must be correct per tier (per tier). Cross-reference the role-seed file for permission seeding.

---

## Core Rule

Every API route that performs a state-changing or data-access operation must enforce RBAC via the `requirePermission` middleware. No route may be exposed without an explicit permission check.

## Reference Documents

- **Permission matrix:** the access-control reference
- **Permission constants:** the shared package
- **Role seed data:** the data layer
- **Auth middleware:** the backend

## Verification Workflow

### Step 1: Identify All Route Handlers

For each module, list all route handlers:

```bash
# Find all route files
find the backend -name 'routes.ts'

# List all route handlers in a module
grep -nE 'router\.(get|post|put|patch|delete)' the backend modules
```

### Step 2: Verify requirePermission Middleware

Every route handler must include `requirePermission` in its middleware chain:

```bash
# Check for routes WITHOUT requirePermission
# Lines with router.get/post/put/patch/delete that do NOT contain requirePermission
grep -nE 'router\.(get|post|put|patch|delete)' the backend modules | grep -v 'requirePermission'
```

Any route that appears in this output is a security gap unless it is explicitly documented as public (e.g., health check, public intake form).

### Step 3: Verify Permission Strings Exist

Every permission string used in `requirePermission('some.permission')` must be defined in the permissions registry:

```bash
# Extract permission strings used in route files
grep -roP "requirePermission\('([^']+)'\)" the backend modules | grep -oP "'[^']+'" | sort -u

# Extract permission strings defined in the permissions registry
grep -oP "'[a-z][a-z_.:]+'|\"[a-z][a-z_.:]+" the shared package | tr -d "'" | tr -d '"' | sort -u

# Find permissions used but not defined (security gap)
comm -23 \
  <(grep -roP "requirePermission\('([^']+)'\)" the backend modules | grep -oP "'[^']+'" | tr -d "'" | sort -u) \
  <(grep -oP "'[a-z][a-z_.:]+'|\"[a-z][a-z_.:]+" the shared package | tr -d "'" | tr -d '"' | sort -u)
```

Any output from the `comm` command indicates a permission string used in routes but not defined in the constants file.

### Step 4: Verify Tier Assignments

Permissions are organized by subscription tier. Each permission must appear in the correct tier array(s):

| Tier | Array | Access Level |
|------|-------|--------------|
| Free | `FREE_PERMISSIONS` | Basic read-only access |
| Starter | `STARTER_PERMISSIONS` | Core module access |
| Professional | `PROFESSIONAL_PERMISSIONS` | Full module access |
| Enterprise | `ENTERPRISE_PERMISSIONS` | All features including admin |

```bash
# Check tier arrays in the permissions registry
grep -A 50 'FREE_PERMISSIONS' the shared package
grep -A 50 'STARTER_PERMISSIONS' the shared package
grep -A 50 'PROFESSIONAL_PERMISSIONS' the shared package
grep -A 50 'ENTERPRISE_PERMISSIONS' the shared package
```

Verify that:
- Higher tiers include all permissions from lower tiers
- Write/delete permissions are not in the Free tier
- Admin permissions are only in Enterprise tier

### Step 5: Verify Role-to-Permission Mapping

Check that `the role-seed file` assigns the correct permissions to each role:

```bash
# Review role definitions in the role-seed file
grep -n 'role:' the data layer
grep -n 'permissions:' the data layer

# Verify the allPermissions array includes new permissions
grep -c 'allPermissions' the data layer
```

### Step 6: Verify Frontend Permission Guards

Frontend components should also check permissions before rendering protected UI elements:

```bash
# Find permission checks in frontend
grep -rn 'hasPermission\|checkPermission\|usePermission' the frontend

# Find admin pages that might lack permission checks
find the frontend pages -name '*.tsx' -exec grep -L 'permission' {} \;
```

## Bulk Verification (All Modules)

```bash
# Count routes vs permission checks across all modules
echo "Total routes:"
grep -rcE 'router\.(get|post|put|patch|delete)' the backend modules | awk -F: '{sum+=$2} END {print sum}'

echo "Routes with requirePermission:"
grep -rcE 'requirePermission' the backend modules | awk -F: '{sum+=$2} END {print sum}'

# Find modules with unprotected routes
for f in $(find the backend -name 'routes.ts'); do
  total=$(grep -cE 'router\.(get|post|put|patch|delete)' "$f" 2>/dev/null || echo 0)
  protected=$(grep -c 'requirePermission' "$f" 2>/dev/null || echo 0)
  if [ "$total" != "$protected" ]; then
    echo "MISMATCH ($protected/$total protected): $f"
  fi
done
```

## Output Format

| Module | Route | Method | Permission | In the permissions registry | In the role-seed file | Tier | Status |
|--------|-------|--------|------------|-------------------|------------------|------|--------|
| tickets | /api/v1/tickets | POST | tickets.create | Yes | Yes | Starter | Pass |
| tickets | /api/v1/tickets/:id | DELETE | tickets.delete | Yes | No | — | Fail |

## Common Issues

1. **Permission defined but not seeded** — Permission exists in the permissions registry but is missing from `the role-seed file` `allPermissions` array. Users cannot access the route.
2. **Route without middleware** — Route handler missing `requirePermission`. Any authenticated user can access it.
3. **Tier escalation** — Write permission incorrectly placed in Free tier instead of Starter or higher.
4. **Frontend/backend mismatch** — Frontend shows a button but the backend rejects the request because the user's role lacks the permission.
5. **Stale permissions after module rename** — Permission string updated in routes but not in the permissions registry or `the role-seed file`.

## Input Schema

```yaml
input:
  scope:
    type: enum[module, all]
    required: true
    description: "Whether to verify a specific module or all modules"
  module_name:
    type: string
    required: false
    description: "Specific module name (required when scope=module)"
  check_frontend:
    type: boolean
    required: false
    default: true
    description: "Whether to also verify frontend permission guards"
```

## Output Schema

```yaml
output:
  verification_table:
    type: array
    items:
      module:
        type: string
      route:
        type: string
      method:
        type: string
      permission:
        type: string
      in_permissions_ts:
        type: boolean
      in_seed_roles_ts:
        type: boolean
      tier:
        type: string
      status:
        type: enum[Pass, Fail]
  unprotected_routes:
    type: array
    description: "Routes missing requirePermission middleware"
  undefined_permissions:
    type: array
    description: "Permission strings used in routes but not defined in the permissions registry"
  summary:
    type: string
    description: "Overall RBAC verification assessment"
```

## Quality Gate

- Every route handler has been checked for requirePermission middleware — no routes skipped.
- All permission strings used in routes exist in the permissions registry and the role-seed file.
- Tier assignments have been verified (no write/delete in Free tier, admin only in Enterprise).
- Frontend permission guards have been cross-referenced with backend route permissions (if check_frontend=true).

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "rbac-verification"
  stage: "S4"
  suggested_next:
    - slug: "audit-trail-verification"
      stage: "S4"
      reason: "After verifying RBAC, verify that state-changing operations emit audit events"
    - slug: "coverage-enforcement"
      stage: "S1"
      reason: "Ensure RBAC middleware and permission checks have adequate test coverage"
```

## Error Handling

- If the permissions registry cannot be parsed (syntax error), halt verification and report the parse failure.
- If a route file uses dynamic permission strings (computed at runtime), flag them for manual review rather than marking as "Fail."
- If the role-seed file structure has changed (e.g., different array names), attempt to detect the new structure before falling back to manual inspection.
- If frontend permission check patterns differ from the expected hasPermission/checkPermission/usePermission, broaden the search pattern and note reduced confidence.
