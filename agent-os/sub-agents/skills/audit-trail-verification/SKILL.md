Title: Audit Trail Verification
Keywords: audit, events, compliance, state changes, taxonomy, logging
Agents: compliance, backend
When to use: When verifying that all state-changing operations emit audit events per the taxonomy, or when reviewing code for missing audit trail coverage.
Version: 1.0.0
Last updated: 2026-03-10

Verify audit events are emitted for every state-changing operation. Cross-reference service files against docs/compliance/audit-event-taxonomy.md. Check event type, payload structure (actor, org, timestamp), and ensure sensitive fields are excluded from logs.

---

## Core Rule

Every state-changing operation in the platform must emit an audit event. This is non-negotiable for a compliance platform.

State-changing operations include:
- Create, update, delete of any entity
- Status transitions (e.g., draft -> active, open -> resolved)
- Permission changes (role assignments, permission grants/revocations)
- Authentication events (login, logout, MFA, password reset)
- Configuration changes (settings, integrations, workflows)
- Data exports and bulk operations

## Reference Document

The authoritative source for audit event types and their required payloads is:

```
docs/compliance/audit-event-taxonomy.md
```

All audit events must match the taxonomy. Do not invent ad-hoc event types.

## Verification Workflow

### Step 1: Identify State-Changing Operations

For each service file in `src/backend/src/modules/<module>/`:

```bash
# Find all service files in a module
find src/backend/src/modules/<module> -name '*-service.ts'

# Look for state-changing methods (create, update, delete, transition, etc.)
grep -nE '(async\s+)(create|update|delete|remove|archive|activate|deactivate|approve|reject|submit|assign|revoke|transition|close|resolve|escalate)' src/backend/src/modules/<module>/*-service.ts
```

### Step 2: Verify Audit Calls Exist

For each state-changing method found, verify it calls `auditService.log`:

```bash
# Check for auditService.log calls in service files
grep -n 'auditService.log' src/backend/src/modules/<module>/*-service.ts

# Cross-reference: methods without audit calls
# Compare the count of state-changing methods vs audit calls
```

### Step 3: Verify Event Types Match Taxonomy

Each `auditService.log` call must use an event type from the taxonomy:

```bash
# Extract event types used in service files
grep -oP "eventType:\s*'[^']+'" src/backend/src/modules/<module>/*-service.ts

# Cross-reference with taxonomy
# Each extracted event type must exist in docs/compliance/audit-event-taxonomy.md
```

### Step 4: Verify Payload Structure

Every audit event payload must include:

| Field | Required | Description |
|-------|----------|-------------|
| `eventType` | Yes | From taxonomy (e.g., `entity.created`, `status.changed`) |
| `actor` | Yes | User ID of the person performing the action |
| `org_id` | Yes | Organization context |
| `timestamp` | Yes | ISO 8601 timestamp (usually auto-set by auditService) |
| `entity_type` | Yes | Type of entity affected (e.g., `ticket`, `vendor`, `assessment`) |
| `entity_id` | Yes | ID of the affected entity |
| `details` | Conditional | Additional context (old/new values for updates, reason for deletions) |

### Step 5: Verify Sensitive Fields Are Excluded

Audit logs must NOT contain:

- Passwords or password hashes
- API keys or tokens
- Personal data beyond what is necessary for the audit record
- Full request/response bodies containing sensitive fields
- Credit card numbers, SSNs, or equivalent PII

```bash
# Check for potential sensitive field logging
grep -nE '(password|secret|token|apiKey|creditCard|ssn)' src/backend/src/modules/<module>/*-service.ts | grep -i audit
```

## Bulk Verification (All Modules)

To verify audit coverage across the entire backend:

```bash
# Count state-changing methods across all modules
grep -rnE '(async\s+)(create|update|delete|remove|archive|activate|deactivate|approve|reject|submit|assign|revoke|transition|close|resolve|escalate)' src/backend/src/modules/ | wc -l

# Count audit calls across all modules
grep -rn 'auditService.log' src/backend/src/modules/ | wc -l

# Find service files with no audit calls (potential gaps)
for f in $(find src/backend/src/modules -name '*-service.ts'); do
  count=$(grep -c 'auditService.log' "$f" 2>/dev/null || echo 0)
  if [ "$count" = "0" ]; then
    echo "NO AUDIT CALLS: $f"
  fi
done
```

## Output Format

When reporting audit trail verification results, use this table format:

| Module | Service | Method | Event Type | Payload OK | Sensitive Fields | Status |
|--------|---------|--------|------------|------------|------------------|--------|
| tickets | ticket-service.ts | create() | ticket.created | Yes | None | Pass |
| tickets | ticket-service.ts | updateStatus() | ticket.status_changed | Missing old_value | None | Fail |

## Common Issues

1. **Missing audit call on delete operations** — Delete methods sometimes skip audit logging because the entity is being removed. The audit event must still be emitted before deletion.
2. **Missing details on status transitions** — Status change events should include both `old_status` and `new_status` in the details.
3. **Bulk operations without per-entity events** — Bulk delete/update must emit one event per affected entity, not a single summary event.
4. **Conditional audit calls** — Audit logging must not be inside conditional blocks that could skip it.

## Input Schema

```yaml
input:
  scope:
    type: enum[module, all]
    required: true
    description: "Whether to audit a specific module or all modules"
  module_name:
    type: string
    required: false
    description: "Specific module name (required when scope=module)"
  taxonomy_path:
    type: string
    required: false
    default: "docs/compliance/audit-event-taxonomy.md"
    description: "Path to the audit event taxonomy reference document"
```

## Output Schema

```yaml
output:
  verification_table:
    type: array
    items:
      module:
        type: string
      service:
        type: string
      method:
        type: string
      event_type:
        type: string
      payload_ok:
        type: boolean
      sensitive_fields:
        type: string
      status:
        type: enum[Pass, Fail]
  gaps:
    type: array
    description: "State-changing methods missing audit calls"
  summary:
    type: string
    description: "Overall audit trail coverage assessment"
```

## Quality Gate

- Every state-changing method in the target scope has been checked for an audit call.
- Event types used in code have been cross-referenced against the taxonomy document.
- Payload structure has been verified for all required fields (eventType, actor, org_id, timestamp, entity_type, entity_id).
- No sensitive fields (passwords, tokens, PII) appear in audit log payloads.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "audit-trail-verification"
  stage: "S4"
  suggested_next:
    - slug: "rbac-verification"
      stage: "S4"
      reason: "After verifying audit trails, verify that routes also enforce RBAC correctly"
    - slug: "coverage-enforcement"
      stage: "S1"
      reason: "Ensure audit-related code paths have adequate test coverage"
```

## Error Handling

- If the taxonomy file is missing or cannot be read, halt verification and report the missing reference document.
- If a service file contains no state-changing methods, mark it as "N/A" rather than "Pass" to avoid false confidence.
- If audit calls use event types not found in the taxonomy, flag them as "undocumented event type" rather than "Fail."
- If bulk verification across all modules exceeds 50 service files, report progress incrementally per module.
