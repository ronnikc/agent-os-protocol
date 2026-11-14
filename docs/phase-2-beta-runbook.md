# Phase 2 beta operator runbook

Marketplace keyboard entry was checked in Chromium at desktop and mobile widths. Enter opens Marketplace, moves focus to its heading, and lets Tab reach the visible Marketplace controls. The navigation exposes its selected state to assistive technology. A manual screen-reader walkthrough and live buyer and specialist qualification remain open.

A signed-in mobile Chromium fixture exercised a two-page listing result. Keyboard activation of **Next listings** moved focus to **Listings and bids** when the button became disabled on the last page. Listing titles sit under that section in the heading hierarchy, and each review button names its listing.

When opening bid details, check that the review button exposes its expanded state and that keyboard focus reaches the heading for the selected listing. Verify that a failed load returns focus to the review button and announces the error.

In an agreement with paginated delivery history, activate **Next evidence page**. Check that the status announces loading and the resulting page number. Interrupt the request and retry from the same button. On successful navigation, confirm focus reaches **Delivery** if it was still on the paging button. In a submission with a workspace run, activate **Load workspace evidence** and confirm focus follows the button to the patch output.

In **Agents → Wallet → CCD receipts**, use a wallet with multiple receipt pages. Page forward and back with the keyboard. Check that loading and the receipt range are announced. At the last page, confirm focus moves to **CCD receipts** when **Next receipts** disappears. Interrupt a page request, verify the current list stays visible, and retry the failed page. Record the screen reader and browser used.

A headless Edge fixture confirmed that a failed page request preserved the current receipts and focus, exposed a retry, and updated the receipt range after recovery. Paging to either end moved focus to the receipt heading when the activated control disappeared. A manual screen-reader session is still required to confirm spoken output.

Open **Agents → Start** and **Tasks → New Task** with the keyboard. In each dialog, verify focus starts on its heading, the fields expose their visible names, Tab stays in the dialog, and Escape returns focus to the opening button.

The release coordinator owns the beta decision. The lobby operator owns invitation, access and rollback. Each provider operator confirms plan limits, metering and teardown. The accessibility reviewer records keyboard and assistive-technology results. Record a named owner and candidate commit for each role before starting a cohort.

## Cohort and scenarios

In **Apps → Hosted run history**, page through a history that spans multiple pages. Verify that loading and result ranges are announced, that focus moves to the history heading when the current paging control becomes unavailable, and that **Retry loading hosted runs** retries the failed page while the previous results remain visible.

A headless Edge fixture checked the loading and error text, suppression of duplicate paging requests, successful retry of a failed second page, and focus at the page boundary. Spoken announcements still need manual confirmation.

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

### Provider qualification report

Keep the report with the candidate's redacted evidence. Run `node agent-os/scripts/check-provider-qualification.mjs <report.json>` to check completeness before reviewing the evidence. The command checks presence and recorded outcomes. Reviewers open the references and confirm that they describe genuine runs on the named candidate.

Generate a blank report once for the cohort from a repository checkout. The release coordinator fills in the candidate SHA and assigns each provider row to its operator. Operators complete their rows after running the scenarios on their own deployments. Keep credentials in Apps and share redacted evidence references with the release coordinator.

```sh
node agent-os/scripts/check-provider-qualification.mjs --template > provider-qualification.json
node agent-os/scripts/check-provider-qualification.mjs provider-qualification.json
```

The check will report missing evidence until the report is complete. Leave unknown billing and reservation states open until the operator reconciles them.

The JSON report uses a full commit SHA in `candidate` and a `providers` array. Each row has these fields:

| Field | Value |
| --- | --- |
| `provider` | One of `e2b`, `agent37`, `daytona`, `modal`, `upstash-box`, `vercel-sandbox` |
| `source` | `live` |
| `operator`, `plan`, `region`, `isolation` | Operator and deployment details. |
| `pinnedRevision` | Full 40-character task commit SHA. Use the same commit across all providers. |
| `scenarios` | Object keyed by `delivery`, `crossLobbyDenial`, `budgetDenial`, `quotaFailure`, `timeout`, `cancellation`, `restartRecovery`, and `deletion`. Each entry records `outcome` and an `evidence` reference. A passing denial scenario means the expected denial was observed. |
| `billingEvidence` | Reference to expected cost, reported cost, and any limitations of the provider's billing data |
| `cleanup`, `pendingReservations` | `confirmed` and `0` after teardown and reconciliation |

For each scenario record outcome, elapsed time from hire to verified delivery, count and reasons for intervention, model and compute cost per accepted task, failed and retried attempts, cleanup failures and review decisions. Derive completion rate from completed scenarios divided by started scenarios. Redact tokens, source links, wallet signatures and private artifacts from shared evidence.

## Rollback and recovery

- Disable new beta requests by setting AGENT_OS_MARKETPLACE_BETA=false. Existing preview records, agreement history and ordinary coordinator tasks remain in the store.
- In Apps, disable new workspace execution and cancel active attempts. Leave the original provider credentials available until every pending cleanup is confirmed. Retry recovery and independently check the provider dashboard for lingering resources before disconnecting.
- Preserve the lobby store and spending ledger. Keep unresolved payment reservations in place until an independent finality check resolves them. Zero-price engagements require neither a signer nor a funded lock.
- Restore the known-good release and retry the documented zero-price scenario. Confirm that private data and artifacts remain inaccessible from another lobby.

The lobby fixture disables Marketplace reads and new listings, checks continued task access under the existing permissions, reopens the persisted store, and restores Marketplace. After restoration it reads preview history, publishes a zero-price listing, and exercises bidding, hiring, submission, and acceptance with a synthetic specialist. It also checks private task isolation. The live rollback drill still requires independent participants and provider cleanup evidence.

### Candidate deployment rollback drill

Use a separate lobby deployment with its own persistent store, encryption key, and provider connections. Record the candidate SHA and known-good SHA before starting. Use a disposable repository and a task with a long enough runtime to observe cancellation. The deployer configures the provider account through Apps.

1. Launch the pinned task and record the run ID. Confirm that the provider shows an allocation before changing policy.
2. In Apps, clear **Enable workspace execution** and save. Confirm the run is cancelled and that a new attempt is denied. Record the policy change and cancellation from hosted audit history.
3. Restart the candidate against the same persistent store and encryption key. If cleanup was pending at restart, verify that it resumes automatically or use **Retry recovery**. Confirm the cleanup state and independently verify deletion in the provider dashboard before disconnecting the provider. If cleanup already finished, record that timing and repeat the restart case before claiming pending-cleanup recovery.
4. Restore the known-good release using the deployment's normal procedure. Verify that the lobby can read its preview records and complete a new zero-price engagement with an invited buyer and specialist. Check cross-lobby access with a separate authorized test account.
5. Record timestamps, candidate and restored revisions, policy and run IDs, cleanup result, dashboard evidence, and the outcome of the post-rollback engagement. Keep provider credentials in the deployment.

The hosted suite exercises the policy change, persisted cancellation, disconnection guard and restart cleanup with a fake provider. Capture separate evidence for the deployment drill.

For provider conformance, record how the provider identifies an attempt, what lookup returns during delayed visibility, and what confirms teardown. A missing allocation after a lost create response can leave cleanup pending. A denied delete also needs a follow-up cleanup check. The Daytona fixture covers both cases and verifies that recovery never submits a second create. Use the live provider dashboard and billing records to resolve any remaining uncertainty.

## Release decision

Require a complete external journey, all six live rows, clean rollback, no unresolved billable workspaces, and passing accessibility and regression checks. Retain the candidate commit, evidence links, deviations and explicit decision. Fixture success supports development readiness. The external cohort, live provider qualification and assistive-technology walkthrough are pending.
