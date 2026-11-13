# Sprint 2.2.0 acceptance evidence

Development and CI use fake provider responses. Deployers configure profiles and lobby managers supply their own account keys. No live provider results have been recorded.

| Criterion | Evidence | Remaining validation |
| --- | --- | --- |
| 1. Account management | Apps exposes masked connection status, eligible profiles and account verification. Hosted fixtures exercise connection, rotation, revocation and manager authorization. | Verify profile and region against the connected account at deployment. |
| 2. Named agent and patch review | The hosted HTTP fixture assigns an agent, launches its workspace and observes the model write to staged files before approved checks. Task details offer the patch for review. Git checks and applies the E2B fixture artifact against a temporary repository baseline without moving its HEAD. | Walk through the repository review with a live workspace patch during opt-in deployment conformance. |
| 3. Source and egress | GitHub fixtures confirm the installation token stays on the control-plane request. Provider fixtures assert deny-all request parameters and model requests omit the workspace credential. | Live opt-in conformance should confirm effective guest egress for the selected profile. |
| 4. Lifecycle | E2B and Agent37 fixtures cover creation, staging, execution, artifacts and deletion. The shared lifecycle fixture covers cancellation, timeout with confirmed teardown, and lost-response recovery across restart. The E2B fixture covers teardown after a failed guest connection. Agent37 documents a seven-day recovery copy. | Confirm the provider responses during opt-in deployment conformance. |
| 5. Usage and idempotency | Both providers tag allocations by run and discover a lost create response without retrying the billable operation. Compute estimates reserve budget and missing provider usage stays pending. | Record observed billing when a supported provider exposes final usage. |
| 6. Apps states | The panel unwraps run history and disables launch and cancellation while requests are pending. The hosted suite covers paginated responses and error envelopes. A headless Edge fixture exercised keyboard submission, disabled pending controls, cancellation dismissal, and focus restoration after cancellation. | Screen-reader behavior remains unverified. |

Deployers can find profile and run instructions in the [hosted panel guide](../../../docs/hosted-panel.md#hosted-limits-and-cloud-workspaces).
