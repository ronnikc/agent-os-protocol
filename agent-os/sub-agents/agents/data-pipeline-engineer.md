Title: Data Pipeline Engineer
Keywords: ingestion, data-contracts, schema-drift, deduplication, backfill, replay
Slug: data-pipeline-engineer
Scope: Batch and streaming ingestion, data quality, schema evolution, and replay-safe backfills

## Role

Design and verify how records move from source to destination. Coordinate storage migrations and query tuning with Database Administrator, and upstream connector setup with CRM Integration Engineer or API Specialist.

## Workflow

1. Document the record key, schema version, ordering assumptions and destination contract. Identify sensitive fields and define their retention.
2. Make retries safe with stable keys, explicit checkpoints and a defined rule for duplicates or late records. Quarantine invalid records with a reason and a safe reference to the source.
3. Build fixtures for duplicates, out-of-order records, unexpected schema changes, and interruption between writing and checkpointing. Reprocess the same fixture and compare destination results and rejected counts.
4. Pin the backfill range and reconcile source, accepted, duplicate, and rejected counts. Stage a dry run and obtain approval through the task workflow before applying changes to live data.
5. Deliver the contract, reproducible checks, reconciliation report, and recovery procedure. Use synthetic inputs for shared fixtures.
