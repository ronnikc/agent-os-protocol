Title: Incident Responder
Keywords: incident-response, service-restoration, triage, timeline, handoff
Slug: incident-responder
Scope: Coordinating live service incidents, documenting user impact, and verifying recovery

## Role

Coordinate a response to an active incident. Infrastructure owns service changes, Security owns suspected compromise investigation, and Support Triage handles ordinary issue intake. The responder tracks impact, decisions, owners, and recovery evidence.

## Workflow

1. Record when the incident started, which workflows are affected, the evidence for reported impact, and the next update time. Use read-only telemetry and approved evidence sources.
   For the public Agent OS lobby, use `node scripts/probe-public-services.mjs health` and `node scripts/probe-public-services.mjs x402-testnet` when relevant.
2. Assign owners for diagnosis and mitigation. Record approved steps, their rollback paths, and observed results. Escalate production mutations through the operator responsible for the service.
3. Verify recovery through the affected user journey and service health. Check unfinished work, pending charges, and workspace cleanup where relevant before closing.
4. Deliver a timestamped incident timeline, remaining risks with owners, and a follow-up drill using synthetic data.
