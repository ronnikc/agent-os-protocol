Title: Service Pattern
Keywords: backend, service, mongodb, AppError, audit, org_id, constructor, pattern
Agents: backend
When to use: When implementing a new backend service or reviewing an existing service for pattern compliance.
Version: 1.0.0
Last updated: 2026-03-10

Backend service implementation pattern for this project. Constructor receives Db (MongoDB database). Methods take org_id as first parameter. Use AppError for all errors. Emit audit events for state changes. Add indexes to indexes.ts. Follow existing service file structure exactly.

---

## Service File Template

Every backend service follows this exact structure. Copy and adapt — do not invent new patterns.

```typescript
// Copyright (c) 2026 R Digital All rights reserved.
// This source code is proprietary and confidential.
// See LICENSE.md for licensing terms.

import { ulid } from 'ulid';
import type { Db, Collection } from 'mongodb';
import { AppError } from '../../middleware/error-handler.js';

export class ExampleService {
  private collection: Collection;
  private auditCollection: Collection;

  constructor(db: Db) {
    this.collection = db.collection('grc_examples');
    this.auditCollection = db.collection('grc_example_audit_events');
  }

  async create(orgId: string, data: CreateExampleInput, userId: string) {
    // 1. Validate required fields
    if (!data.name) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Missing required field: name');
    }

    // 2. Check business rules (uniqueness, limits, etc.)
    const existing = await this.collection.findOne({
      org_id: orgId,
      name: data.name,
    } as any);
    if (existing) {
      throw new AppError(409, 'EXAMPLE_ALREADY_EXISTS', `Example '${data.name}' already exists`);
    }

    // 3. Build document
    const now = new Date().toISOString();
    const doc = {
      _id: ulid(),
      example_id: crypto.randomUUID(),
      org_id: orgId,
      ...data,
      status: 'active',
      created_at: now,
      updated_at: now,
      created_by: userId,
    };

    // 4. Insert (always cast as any for MongoDB types)
    await this.collection.insertOne(doc as any);

    // 5. Audit log
    await this.auditLog(orgId, doc.example_id, 'created', userId, undefined, doc);

    return doc;
  }

  async list(orgId: string, page: number, pageSize: number, filters?: Record<string, string>) {
    const filter: any = { org_id: orgId };
    if (filters?.status) filter.status = filters.status;

    const [data, total] = await Promise.all([
      this.collection
        .find(filter)
        .sort({ created_at: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      this.collection.countDocuments(filter),
    ]);

    // Always return this exact pagination shape
    return { data, total, page, page_size: pageSize };
  }

  async getById(orgId: string, exampleId: string) {
    const doc = await this.collection.findOne({
      org_id: orgId,
      example_id: exampleId,
    });
    if (!doc) {
      throw new AppError(404, 'EXAMPLE_NOT_FOUND', `Example ${exampleId} not found`);
    }
    return doc;
  }

  async update(orgId: string, exampleId: string, data: Partial<CreateExampleInput>, userId: string) {
    const existing = await this.getById(orgId, exampleId);
    const now = new Date().toISOString();

    await this.collection.updateOne(
      { org_id: orgId, example_id: exampleId } as any,
      { $set: { ...data, updated_at: now } } as any,
    );

    await this.auditLog(orgId, exampleId, 'updated', userId, existing, { ...existing, ...data });

    return this.getById(orgId, exampleId);
  }

  async delete(orgId: string, exampleId: string, userId: string) {
    const existing = await this.getById(orgId, exampleId);

    await this.collection.deleteOne({
      org_id: orgId,
      example_id: exampleId,
    });

    await this.auditLog(orgId, exampleId, 'deleted', userId, existing, undefined);
  }

  private async auditLog(
    orgId: string,
    entityId: string,
    action: string,
    actorId: string,
    before: unknown,
    after: unknown,
  ) {
    const event = {
      _id: ulid(),
      org_id: orgId,
      entity_type: 'example',
      entity_id: entityId,
      action,
      actor_id: actorId,
      timestamp: new Date().toISOString(),
      before,
      after,
    };
    await this.auditCollection.insertOne(event as any);
  }
}
```

## Key Rules

### Constructor

- Receives `db: Db` (MongoDB database instance)
- Initializes collection references with `db.collection('grc_<module_name>')`
- Always create a separate audit collection: `db.collection('grc_<module>_audit_events')`

### Method Signatures

- First parameter is always `orgId: string` (organization scope)
- State-changing methods also take `userId: string` as the last parameter
- List methods take `page: number, pageSize: number` and return `{ data, total, page, page_size }`

### Error Handling

- Always use `AppError`: `new AppError(statusCode, 'ERROR_CODE', 'Human message')`
- Import from: `import { AppError } from '../../middleware/error-handler.js'`
- Parameter order is `(status, code, message)` — NOT `(message, status)`
- Standard error codes: `VALIDATION_ERROR` (400), `*_NOT_FOUND` (404), `*_ALREADY_EXISTS` (409)

### MongoDB Patterns

- Always cast filter objects: `{ org_id: orgId, ... } as any`
- Always cast `$set`/`$push` operations: `{ $set: { ... } } as any`
- Always cast `insertOne` input: `doc as any`
- Use `ulid()` for `_id` fields
- Use `crypto.randomUUID()` for entity-specific IDs

### Audit Events

- Every state-changing operation (`create`, `update`, `delete`, status transitions) must emit an audit event
- Audit log is a private method on the service
- Event shape: `{ _id, org_id, entity_type, entity_id, action, actor_id, timestamp, before, after }`

### Indexes

- Add indexes to the data layer for every collection
- Minimum: compound index on `{ org_id: 1, <entity_id>: 1 }` with unique constraint
- Add indexes for any fields used in filters or sort

### Wiring

- Instantiate in the backend
- Pass `db` to constructor
- Pass service instance to route factory
- Mount routes at `/api/v1/<module>`

## Checklist

- [ ] Constructor receives `db: Db`
- [ ] All methods take `orgId` as first parameter
- [ ] AppError used for all errors with correct parameter order
- [ ] MongoDB casts use `as any`
- [ ] Audit events emitted for create, update, delete
- [ ] Pagination returns `{ data, total, page, page_size }`
- [ ] Indexes added to `indexes.ts`
- [ ] Service wired in `app.ts`

## Input Schema

```yaml
inputs:
  module_name:
    type: string
    required: true
    description: "Name of the module (e.g., 'tasks', 'vendors'). Used for collection names, file paths, and route mounting."
  entity_name:
    type: string
    required: true
    description: "Singular entity name (e.g., 'task', 'vendor'). Used for type names, variable names, and error codes."
  fields:
    type: array
    required: true
    description: "List of entity fields with name, type, and required flag. Drives document shape and validation."
  has_status:
    type: boolean
    required: false
    default: true
    description: "Whether the entity has a status field with lifecycle transitions."
```

## Output Schema

```yaml
outputs:
  service_file:
    type: file_path
    description: "Path to the created/updated service file (the backend modules)"
  index_entries:
    type: array
    description: "Index definitions added to the data layer
  app_wiring:
    type: object
    description: "Import and mount statements added to the backend
  audit_collection:
    type: string
    description: "Name of the audit collection created (grc_<module>_audit_events)"
```

## Quality Gate

- All methods take `orgId: string` as the first parameter and state-changing methods take `userId: string` as the last parameter.
- `AppError` is used for all error paths with correct parameter order `(status, code, message)`.
- Audit events are emitted for every state-changing operation (create, update, delete, status transitions).
- Indexes are registered in `indexes.ts` with at least a compound unique index on `{ org_id: 1, <entity_id>: 1 }`.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "service-pattern"
  stage: "S1"
  suggested_next:
    - slug: "test-patterns"
      stage: "S1"
      reason: "Backend service tests should be written immediately after creating the service"
    - slug: "api-contract-validation"
      stage: "S1"
      reason: "Validate that the new service contract aligns with frontend expectations"
    - slug: "seed-data"
      stage: "S1"
      reason: "Add permissions and sample data for the new service module"
```

## Error Handling

- If the module directory does not exist, create it at the backend modules before writing the service file.
- If `indexes.ts` already contains an entry for the same collection, update the existing entry rather than adding a duplicate.
- If `app.ts` already imports or mounts a route for this module, skip wiring to avoid duplicate route registration.
- If field names conflict with reserved MongoDB fields (`_id`, `_class`), prefix with the entity name to avoid collisions.
