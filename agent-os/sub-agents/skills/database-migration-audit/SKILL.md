Title: Database Migration Audit
Keywords: database-audit, migrations, sql-audit, indexing-check, data-integrity
Agents: database-administrator, backend
When to use: When proposing or executing database migrations, database schema updates, or indexing adjustments.
Version: 1.0.0
Last updated: 2026-06-30

Audit database schema migrations, indexes, query patterns, and rollback procedures to guarantee data integrity and query efficiency.

---

## Workflow

### Step 1 — Review Migration Script
Parse the proposed database migration script (SQL, Mongo script, or ORM code). Verify that:
- It includes both `up` (apply) and `down` (rollback) paths.
- Semicolons and transactions are correctly configured (where supported) to prevent partial migrations on failure.

### Step 2 — Verify Index Coverage
Examine any new tables, columns, or modified queries:
- Assert that foreign keys and fields frequently used in filters (`WHERE`, `match`, `join`) have corresponding indexes.
- Reject tables lacking primary keys or unique constraint validations.

### Step 3 — Data Safety Assessment
Scan for potential data-loss operations:
- Flag actions like dropping tables, columns, or changing datatypes without intermediary steps (e.g. rename → migrate data → drop).
- Assert that default values are set for any new non-nullable fields.

### Step 4 — Generate DBA Report
Compile a summary of index gaps, rollback risks, data-loss warnings, and query recommendations.

---

## Input Schema

```yaml
input:
  migration_file_path:
    type: string
    required: true
    description: "Path to the migration script to audit"
  database_type:
    type: enum
    values: [postgres, mysql, mongodb, sqlite]
    required: true
    description: "The targeted database engine"
```

## Output Schema

```yaml
output:
  migration_verdict:
    type: object
    properties:
      status: { type: enum, values: [Approved, Blocked] }
      warnings_count: { type: integer }
  checks:
    type: array
    items:
      type: object
      properties:
        rule_name: { type: string }
        outcome: { type: enum, values: [Passed, Failed, Warning] }
        details: { type: string }
```

## Quality Gate

- Every migration file has a valid, non-empty rollback (`down`) procedure
- Sizing indexes are created for all foreign-keys and match fields
- Non-nullable fields have explicit default values set

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "database-migration-audit"
  stage: "S1"
  suggested_next:
    - slug: "service-pattern"
      stage: "S1"
      reason: "Audited database schema must be accessed using service-layer patterns"
```

## Error Handling

- If the migration script is empty or missing, return a validation failure.
- If data-destructive statements (e.g. `DROP COLUMN`, `DROP TABLE`) are found without a safety override flag, block the migration.
