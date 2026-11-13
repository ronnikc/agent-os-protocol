# Phase 2 beta operator runbook

The release coordinator owns the beta decision. The lobby operator owns invitation, access and rollback. Each provider operator confirms plan limits, metering and teardown. The accessibility reviewer records keyboard and assistive-technology results. Record a named owner and candidate commit for each role before starting a cohort.

## Cohort and scenarios

1. Invite an external buyer and an independently operated specialist to a private lobby. Start with fresh installs and wallets. Follow the [hosted onboarding](hosted-onboarding.md) and [marketplace onboarding](marketplace-onboarding.md) guides.
2. Publish and filter a specialist profile, agree zero-price terms, and verify the named task. Repeat the journey with local, hosted and cloud execution. Compare the pinned revision, review decision, artifacts and access boundaries. Include a revision, cancellation and independent dispute resolution.
3. Run the same pinned task for each provider. Check unauthorized access, budget denial, quota failure, timeout, operator cancellation, restart reconciliation and deletion. Record expected cost, vendor-reported cost when available, and any reservation still pending.
4. Test keyboard navigation and visible focus through Apps, bid and agreement actions, evidence pages, and wallet receipt pages. Record screen reader, browser, steps and outcome. Verify error text, loading announcements, disabled mutations and page navigation after failures.
5. Repeat any failed scenario on the fixed candidate. Record what changed and link the retest.

| Provider | Tier, isolation, region and revision | Finality and billing evidence |
| --- | --- | --- |
| E2B | Pending live run | Pending |
| Agent37 | Pending live run | Pending |
| Daytona | Pending live run | Pending |
| Modal | Pending live run | Pending |
| Upstash Box | Pending live run | Pending |
| Vercel Sandbox | Pending live run | Pending |

For each scenario record outcome, elapsed time from hire to verified delivery, count and reasons for intervention, model and compute cost per accepted task, failed and retried attempts, cleanup failures and review decisions. Derive completion rate from completed scenarios divided by started scenarios. Redact tokens, source links, wallet signatures and private artifacts from shared evidence.

## Rollback and recovery

- Disable new beta requests by clearing AGENT_OS_MARKETPLACE_BETA. Existing preview records, agreement history and ordinary coordinator tasks remain in the store.
- In Apps, disable new workspace execution and cancel active attempts. Leave the original provider credentials available until every pending cleanup is confirmed. Retry recovery and independently check the provider dashboard for lingering resources before disconnecting.
- Preserve the lobby store and spending ledger. Keep unresolved payment reservations in place until an independent finality check resolves them. Zero-price engagements require neither a signer nor a funded lock.
- Restore the known-good release and retry the documented zero-price scenario. Confirm that private data and artifacts remain inaccessible from another lobby.

### Candidate deployment rollback drill

Use a separate lobby deployment with its own persistent store, encryption key, and provider connections. Record the candidate SHA and known-good SHA before starting. Use a disposable repository and a task with a long enough runtime to observe cancellation. The deployer configures the provider account through Apps.

1. Launch the pinned task and record the run ID. Confirm that the provider shows an allocation before changing policy.
2. In Apps, clear **Enable workspace execution** and save. Confirm the run is cancelled and that a new attempt is denied. Record the policy change and cancellation from hosted audit history.
3. Restart the candidate against the same persistent store and encryption key. If cleanup was pending at restart, verify that it resumes automatically or use **Retry recovery**. Confirm the cleanup state and independently verify deletion in the provider dashboard before disconnecting the provider. If cleanup already finished, record that timing and repeat the restart case before claiming pending-cleanup recovery.
4. Restore the known-good release using the deployment's normal procedure. Verify that the lobby can read its preview records and complete a new zero-price engagement with an invited buyer and specialist. Check cross-lobby access with a separate authorized test account.
5. Record timestamps, candidate and restored revisions, policy and run IDs, cleanup result, dashboard evidence, and the outcome of the post-rollback engagement. Keep provider credentials in the deployment.

The hosted suite exercises the policy change, persisted cancellation, disconnection guard and restart cleanup with a fake provider. Capture separate evidence for the deployment drill.

## Release decision

Require a complete external journey, all six live rows, clean rollback, no unresolved billable workspaces, and passing accessibility and regression checks. Retain the candidate commit, evidence links, deviations and explicit decision. Fixture success supports development readiness. The external cohort, live provider qualification and assistive-technology walkthrough are pending.
