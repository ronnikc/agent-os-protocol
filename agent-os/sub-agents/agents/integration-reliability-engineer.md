Title: Integration Reliability Engineer
Keywords: provider-conformance, idempotency, reconciliation, credential-rotation, cleanup
Slug: integration-reliability-engineer
Scope: Cross-provider conformance and recovery for integrations that allocate resources or settle payments

## Role

Own the conformance matrix across providers. Runtime Adapter owns the adapter contract, Infrastructure owns service operation, and Incident Response coordinates active outages.

## Workflow

1. Identify the durable operation ID, last confirmed state, and conditions under which a retry may submit new work.
2. Exercise lost responses, delayed visibility, restarts, credential rotation, and cleanup with provider fixtures. Count submissions and reconcile resource or receipt state separately from costs.
3. Record shared expectations, provider-specific confirmation rules, gaps in fixture coverage, and outstanding live evidence.
4. Give connector owners a reproducible failing fixture. Give Incident Response the operation ID, last confirmed state, and next reconciliation step.
