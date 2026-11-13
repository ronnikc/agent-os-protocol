# Sprint 2.1.0 execution evidence

Implementation followed T-210-1 through T-210-4. The checkout has no reuse catalog. The sprint reused the lobby manager predicate, wallet sessions, Apps request wrapper, hosted secret box and lobby store. The commerce ledger informed the reservation pattern. Hosted accounting uses independent token and compute balances.

## API contract trace

The existing lobby mounts wallet-gated hosted agents at `/api/v1/agent-lobby/lobbies/:id/hosted-agents` and owner-connected services at `/api/v1/agent-lobby/lobbies/:id/integrations/:provider`. The standalone panel relays existing calls through `agent-os-panel-server.ts`. The hosted Apps tab uses the SPA's remote-route mapper in `app.js`, which applies the wallet bearer token and lobby scope before sending directly to the lobby server.

Under `/api/v1/agent-lobby/lobbies/:id`, all new routes require a valid lobby-scoped bearer token and an active manager.

| Method and path | Body | Success |
| --- | --- | --- |
| GET /hosted-controls | None | 200 with policy, capabilities and masked connections |
| PUT /hosted-controls | Period hours, both per-run and period ceilings, concurrency, deadline in milliseconds and workspace enable flag | 200 with policy |
| POST /integrations/cloud-workspaces/:provider | Action and credential for connect or rotate | 200 with updated settings |
| GET /hosted-runs | Optional offset and limit | 200 with data, total, offset and limit |
| GET /hosted-runs/audit | Optional offset and limit | 200 with data, total, offset and limit |
| POST /hosted-runs | Task, attempt, connection, profile, region and pinned source revision | 202 with run |
| DELETE /hosted-runs/:id | None | 202 with accepted flag |
| POST /hosted-runs/recover | None | 202 with accepted flag |

Failures return an error message. 400 covers invalid input, 401 invalid or wrong-lobby credentials, 403 a non-manager session, 404 absent resources in the requested lobby, 409 conflicting operations or admission limits, and 503 persistence or unexpected control errors.

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| 1. Capability and attempt binding | Shared workspace contract defines profiles, isolation, egress, region, runtime, credentials, deletion and usage. Fake adapter checks pinned commit and approved region. Wire tests deny a foreign task or connection. |
| 2. Durable lifecycle and cleanup | Fake provisioning allocates then loses its response. A restarted server reuses the attempt key, collects evidence and later confirms deletion following another restart. Duplicate submission returns the same run. |
| 3. Budgets, concurrency, deadlines and reconciliation | Concurrent HTTP compute reservations yield one admission and one denial. Concurrent model calls reach the fake API only once when the remaining period budget cannot cover the second reservation. Fixtures cover final usage, unknown usage beyond the rolling period, concurrency and timeout. |
| 4. Manager controls and secrets | Wire checks verify wallet scope and observer denial, sealed persistence, masked status, enable/disable, rotation and disconnection. The model fixture runs with workspace execution disabled. |
| 5. Cancellation and audit | Wire checks cancel an active workspace and confirm deletion and owner-attributed audit. A separate model fixture observes abort on the in-flight request and keeps unknown usage reserved. A second lobby cannot cancel the run. |
| 6. Apps controls | Apps unwraps the data page, displays reported and pending usage, reads server error messages, retains input on failure and disables duplicate submissions. Controls use native labeled inputs, selects and buttons, explicit units, live status and focus restoration after cancellation. Browser and assistive-technology coverage is recorded separately below. |

## Scope and release gates

The production adapter registry starts empty. One lobby writer owns each durable state file. Model budgets use token units, and provider-reported usage above a reservation is recorded and audited. In-flight provider operations rely on cooperative cancellation and confirmed cleanup. Live Concordium PLL remains gated on released support and testnet evidence. Public recording and benchmarks follow Sprint 2.8.0 beta stabilization in Sprint 2.9.0.

## Verification results

- Pre-implementation gate passed all automated checks. The manual closeout planning item was recorded before implementation.
- TypeScript workspace build passed with `node_modules/.bin/tsc.cmd -b --pretty false`.
- `npm run verify-hosted` passed 57 checks, `npm run verify-lobby` passed 32 and `npm run verify-ui` passed 10. The affected provider and runtime adapter suites passed 11 and 21 checks respectively.
- The hosted fixture booted a real lobby HTTP server on an ephemeral port, restarted it twice from the same durable store, and exercised authorization, pagination, cancellation, reconciliation and cleanup.
- The generic closeout script exited at its legacy `src/frontend` layout after looking for three absent `src/*/tsconfig.json` files. This repository uses TypeScript project references under `packages/` and the sprint-specific npm verification commands above.
- Apps accessibility was checked in source and through the UI regression suite. Interactive keyboard and assistive-technology testing remain review items.
