<!-- SPDX-License-Identifier: Apache-2.0 -->

# Agent IDs, x401 proofs, and x402 payments

Agent OS uses Concordium Agent IDs for roster accountability. HTTP resources can separately ask for a credential presentation through x401 or quote a payment through x402. The resource decides which checks it needs.

## Set up an agent identity and wallet

1. Use the panel's **Identity** or **Agents** view to register or link an Agent ID. For a local relay, keep the DID in its local configuration and reconnect it. For a hosted agent, save the DID in the connected repository. Merge the binding pull request if the branch is protected, then restart that agent.
2. Open the Agent ID Card from the roster. Its registry and explorer links identify the same active registration. Keep the DID when restarting or reconnecting an agent.
3. For payment experiments, [create and fund a dedicated agent account](fund-concordium-agent-wallet.md). The spending signer belongs to the agent's payment service. A recipient only supplies a receiving address.

The [mainnet operator workflow](fund-concordium-agent-wallet.md#prepare-a-mainnet-binding-or-rotation) reads a finalized wallet binding and prepares a new owner transaction. The [Phase 2 plan](agent-wallets-and-payments-plan.md) tracks panel integration and live rotation.

## Verify protocol conformance

Run `npm run verify-commerce` for deterministic proof, payment, and recovery fixtures. For x401, check challenge handling, issuer and holder binding, expiry, revocation and replay. For x402, check the network, asset, recipient, sponsor and amount, then retry the original signed payment after simulating an interrupted response. Record fixture outcomes, independent verifier or facilitator results, and finalized chain evidence as separate results.

Use `node scripts/probe-public-services.mjs x401-proof`, `node scripts/probe-public-services.mjs x402-testnet`, and `node scripts/probe-public-services.mjs x402-mainnet-gate` to record timestamped deployment observations. The x401 command exercises the synthetic proof and replay. The x402 commands inspect unsigned responses. A Testnet quote establishes endpoint availability. Independent interoperability and chain settlement require their own evidence.

## x401 credential exchange

The commerce client fetches an approved HTTPS resource. If the response includes `PROOF-REQUEST`, the client parses the x401 0.2.0 challenge with the Proof SDK and asks the configured `presentProof` callback to produce a credential presentation. The callback is responsible for verifier trust, permitted attributes, and holder consent. The client retries once with `PROOF-RESPONSE`. It stops before payment if the resource rejects the presentation.

An Agent ID Card links an agent DID to its owner’s Concordium account in the registry. The Agent ID credential profile uses that binding for x401:

1. The issuer resolves the active registry record and checks the card. The registered owner approves a delegation for a specific agent presentation key, HTTPS resource, and expiry. Verify the wallet signature against the owner’s current on-chain credentials.
2. The issuer creates a short-lived, holder-bound SD-JWT credential. It carries the agent DID, owner account, registry record and approved resource.
3. The agent answers the resource’s OpenID4VP challenge by signing the fresh nonce and verifier audience with the delegated key. The verifier checks the trusted issuer, holder signature, resource, expiry, and current registry binding, then consumes the nonce.

The Mainnet QA pilot used Agent Registry token 5123 and verified the registered owner’s wallet signature against Mainnet. Both the reference verifier and a separate local harness using OpenWallet Foundation’s SD-JWT implementation accepted the x401 presentation and rejected replay. The fixture also covers a copied DID, a different signing key and an inactive registration. Provisioning a hosted agent and exchanging its credential with an independently operated verifier remain release checks. [x401 specification](https://x401.proof.com/spec/latest/) · [OpenID4VP](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html) · [SD-JWT](https://www.rfc-editor.org/rfc/rfc9901.html)

Hosted API agents can use the `access_agent_id_resource` tool when the operator configures `AGENT_OS_HOSTED_AGENT_ID_PROOF_FILE` and starts the matching agent. Store the JSON file outside the checkout with access limited to the lobby process. It contains `lobbyId`, `did`, the exact HTTPS `resource`, the issued SD-JWT `credential`, and the delegated Ed25519 `holderPrivateKeyPem`. The agent must be connected with that verified DID. Refresh the short-lived credential before it expires. Keep the lobby, DID and resource the same when refreshing. Restart the agent if those settings change.

The runtime supports the profile’s unsigned OpenID4VP DC API request for its Agent ID credential type. It sends the presentation only to the configured URL, rejects redirects, and reports the access result to the model. This tool performs proof access. Payment authorization remains in the separate x402 workflow.

## Try the x401 Proof Test

Open the [x401 Proof Test](https://lobby.agent-os-protocol.com/panel/x401-test.html) and select **Run proof test**. It uses an ephemeral issuer and a synthetic Agent ID to request a credential, verify a holder-bound OpenID4VP presentation, and reject replay. The result shows HTTP 200 for the accepted proof and HTTP 401 for the replay. No wallet or payment is needed.

To inspect the challenge with your own HTTP client, send an unsigned GET to `/api/v1/agent-lobby/x401/test-resource` and look for HTTP 401 with `PROOF-REQUEST`. The demo issuer is trusted only by this test resource. This exercise does not count toward the independent verifier release check described above.

Deployers can set `AGENT_OS_X401_TEST_ORIGIN` to their public HTTPS origin to bind credential audiences to their own host. For a local walkthrough, run `npm run lobby` and open `http://localhost:4730/panel/x401-test.html`. The local page runs the synthetic exchange through the bundled test harness.

## Try the Concordium Mainnet Proof Pilot

1. On the device where your Concordium Wallet for Web is installed, open the [Mainnet Proof Pilot](https://agent-os-protocol.com/mainnet-proof).
2. Unlock the wallet, select Mainnet and an account with a Concordium identity, then choose **Request proof in Concordium Wallet**.
3. Review the age-range request in the wallet and approve it if you agree. This produces a zero-knowledge proof without revealing your date of birth. It does not send a transaction or spend CCD.
4. The page displays the result after Concordium’s Mainnet verifier checks the proof. The site forwards the presentation and its credential identifier for verification and does not persist them. If a challenge expires, request a new proof.

The website opens the pilot on the hosted panel's domain, where your browser wallet connects to the panel. To test locally, run `npm run lobby` and open `http://localhost:4730/panel/mainnet-proof.html`. The pilot demonstrates [native Concordium Web3 ID verification](https://docs.concordium.com/en/mainnet/how-to/web3-id/create-proofs.html). The live x401 release gate requires a separate OpenID4VP exchange.

## x402 v2 sponsored payment

1. The resource returns HTTP 402 with `PAYMENT-REQUIRED`. Configure the commerce policy with the full resource URL, network, payer, recipient, asset, facilitator fee payer, and maximum amount in atomic units. For native CCD, one CCD is 1,000,000 microCCD.
2. The client accepts one matching Concordium `exact` quote. Use `requestWithSpendingLimit` and a local `SpendingLedger` to reserve against the daily budget before releasing the signer.
3. The client retries with `PAYMENT-SIGNATURE`. The facilitator verifies the transaction, signs as sponsor, and submits it. The caller's `verifySettlement` callback compares `PAYMENT-RESPONSE` with the approved quote and finalized chain data.
4. If settlement is uncertain, reconcile the recorded nonce and expiry against the chain before releasing the reservation. Use the same request ID for reconciliation and keep the signing service's ledger private.

Use a facilitator that explicitly advertises the target network and supports the quoted asset. A local merchant fixture and the official facilitator SDK settled a 1 CCD mainnet payment from the rotated QA agent wallet. An independent chain query verified the payer, recipient, amount, and fee sponsor. A hosted merchant interoperability test remains open. See the [Concordium x402 exact scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_concordium.md).

### Public Concordium Testnet merchant

The public lobby deployment returned an unconfigured Testnet merchant response on November 14, 2026, at revision `eb8fa0d`. At the same revision, the hosted x401 synthetic check accepted its proof and rejected replay, and the unsigned Mainnet merchant probe confirmed that the public pilot was disabled. These checks used no funded wallet. Recheck current status with `node scripts/probe-public-services.mjs x402-testnet`, `x401-proof`, and `x402-mainnet-gate` as separate invocations.

Open the [x402 Testnet Merchant](https://lobby.agent-os-protocol.com/panel/x402-merchant.html) to check availability, inspect the quote and copy the endpoint. Use your own funded Testnet account and an x402 v2 client that supports Concordium sponsored exact payments. The quote specifies the native CCD amount, merchant recipient and fee sponsor. The merchant returns the transaction, payer, recipient, sponsor, amount and a Testnet explorer link after verifying the finalized transfer on Concordium Testnet.

Deployers can enable the route by setting `AGENT_OS_X402_TESTNET_MERCHANT_FILE` to an absolute path to a private JSON configuration. Use these fields:

| Field | Value |
| --- | --- |
| `resource` | Canonical public HTTPS URL ending in `/api/v1/agent-lobby/x402/testnet-resource`. |
| `recipient` | The deployer's Testnet merchant account. Use a dedicated account for this resource. |
| `sponsor` | The distinct Testnet fee payer advertised by the facilitator. |
| `amountMicroCcd` | String `"1000000"` for 1 CCD or `"10000000"` for 10 CCD. |
| `facilitatorUrl` | Deployer-operated HTTPS x402 facilitator supporting Concordium Testnet exact v2 and native CCD. |
| `facilitatorToken` | Optional service bearer token. Keep it in the server configuration. |
| `receiptDirectory` | Absolute path to persistent, writable storage. Use a separate directory for each deployment and keep it across restarts. Run one merchant instance per directory. |

An unsigned GET returns HTTP 402 with `PAYMENT-REQUIRED` when the configured facilitator advertises the exact Testnet scheme and sponsor. Submit the signed payment in `PAYMENT-SIGNATURE` and retain that header until you receive the finalized receipt. If a response is lost, replay the same header. The server uses the recorded transaction hash to recheck finality without another settlement call. If the facilitator response was lost before the hash was recorded, the server keeps the attempt reserved. Check the facilitator and chain before signing a new payment. A deployment without configuration returns 503.

After restarting the lobby service with the configuration, run `curl -i https://your-lobby.example/api/v1/agent-lobby/x402/testnet-resource`. Expect HTTP 402 with the quote header. If the endpoint returns 503 with an unconfigured message, check the configuration path, file permissions and server startup logs. If settlement is unavailable, check that the facilitator is reachable from the lobby server and that its `/supported` response advertises x402 v2, the Concordium Testnet network and the configured sponsor.

### Invite-only Mainnet pilot

The lobby server can host a demo resource at `/api/v1/agent-lobby/x402/test-resource`. An enabled merchant quotes a real Mainnet CCD payment and returns a receipt and explorer link after checking the finalized transfer. The resource costs 1 CCD during the first pilot. Operators can select 10 CCD for a later demo. CCD goes to the configured merchant account, and the facilitator sponsor pays the network fee.

Set `AGENT_OS_X402_TEST_MERCHANT_FILE` to the absolute path of an operator-only JSON file outside the checkout. Configure the following fields.

| Field | Value |
| --- | --- |
| `resource` | The full public HTTPS URL of the demo resource, ending in `/api/v1/agent-lobby/x402/test-resource`. |
| `recipient` | The public address of a dedicated merchant receiving account. |
| `sponsor` | The public fee-payer address advertised by the facilitator. |
| `amountMicroCcd` | `"1000000"` for 1 CCD or `"10000000"` for 10 CCD. |
| `facilitatorUrl` | The HTTPS base URL of an x402 facilitator that supports Concordium Mainnet exact v2 and native CCD. You can operate a separate facilitator using the official Concordium SDK. |
| `facilitatorToken` | An optional bearer token for the facilitator. |
| `receiptDirectory` | An absolute persistent directory where the merchant records redeemed transaction hashes. Preserve this directory across deployments. |
| `inviteToken` | A random token of at least 32 characters for the invite-only pilot. |
| `publicAccess` | Omit this setting. Mainnet requires an invitation. |

Use a separate funded payer account. To inspect the quote, send a GET with the invite token in the `Authorization: Bearer` header. The response is HTTP 402 with `PAYMENT-REQUIRED`. Confirm the amount, merchant address, and sponsor before authorizing the payment. Agent OS clients can use `requestWithSpendingLimit` with the exact resource and those approved values. For an invite, pass a fetch wrapper that adds the bearer token to each request to this resource. Check the final transaction and `PAYMENT-RESPONSE` before treating access as paid. If settlement is unconfirmed, reconcile the payer nonce on-chain before authorizing another attempt.

The Mainnet endpoint remains disabled until an operator provisions and approves the separate pilot. The local HTTP fixture covers invitation checks, modified quotes, unconfirmed settlement and duplicate receipts.

For the invite-only 1 CCD pilot, the lobby can also run the official Concordium facilitator SDK in process. Omit `facilitatorUrl` and set `pilotPayer` to the one approved Mainnet payer address. Set `pilotSponsorKeyFile` to an absolute, operator-only file containing the dedicated sponsor’s 32-byte hexadecimal account signing key. The file must be readable by the lobby process. Keep the merchant, payer and sponsor accounts distinct. The merchant checks that the sponsor key matches its current account credentials and that the account has a positive available balance before quoting. Fund the sponsor for network fees and the payer with 1 CCD once the hosted quote has been checked.

The self-hosted option reserves one settlement attempt on disk before it signs. Keep `self-hosted-pilot-attempt.json` in the persistent receipt directory across restarts. After an uncertain outcome, reconcile the payer nonce and Mainnet history before provisioning a new attempt. This mode requires the invite token and does not support public access.

#### Windows sponsor over SSH

Run `agent-os/scripts/x402-pilot-facilitator.ts` on Windows to keep sponsor signing on that machine. Its local JSON config uses `resource`, `recipient`, `sponsor`, `amountMicroCcd`, `pilotPayer`, `facilitatorToken`, and a persistent local `receiptDirectory`. Use a random bearer token of at least 32 characters. Pass the local config path as the only argument and pipe the sponsor key from the DPAPI store through standard input. The process verifies the sponsor on Mainnet before listening on `127.0.0.1:4739`.

From Windows, open the reverse tunnel with a verified SSH host key and a forwarding-enabled login on the lobby host:

```powershell
ssh -NT -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -R 127.0.0.1:4739:127.0.0.1:4739 user@lobby-host
```

On the lobby host, keep the merchant configuration private and set `facilitatorOverSsh` to `true`, `facilitatorUrl` to `http://127.0.0.1:4739`, and `facilitatorToken` to the matching token. The lobby configuration uses an invite token and a separate persistent receipt directory writable by the lobby service. Keep the SSH remote listener bound to loopback. The encrypted SSH connection carries the facilitator traffic between machines.

Check that the invited merchant returns HTTP 402 with exactly `1000000` microCCD and the approved recipient and sponsor before funding the payer. Keep the Windows facilitator and SSH connection running through finalization.

## Concordium Verify & Pay pilot

Concordium also documents a transaction-hash flow. A local test resource returned HTTP 402 for 10 CCD. The QA wallet submitted the payment on mainnet and paid the network fee. The client retried with the transaction hash in `X-PAYMENT`. A local verifier checked finality, sender, recipient, and amount before granting access and rejected a replay. This evidence covers the transaction-hash flow. The sponsored v2 flow uses a different wire format and settlement path. [Concordium Verify & Pay guide](https://docs.concordium.com/en/mainnet/how-to/integrations/x402-integration.html)

## Run the repository checks

```bash
npm ci
npm run verify-identity
npm run verify-commerce
```

The commerce suite checks proof gating, quote validation, sponsored transaction construction, settlement handling, and spending reservations with test fixtures. It requires no funded account. For rollout criteria and outstanding integration work, see the [Phase 2 plan](agent-wallets-and-payments-plan.md).

## Sprint 2.6 verification boundary

Run npm run verify-commerce, npm run verify-identity and npm run verify-hosted. The local fixtures exercise finalized wallet adoption and rotation, wrong network and owner rejection, replay and durable reservations, and pagination without exposing signed submissions. Independent hosted x401 and x402 evidence, PLT settlement, and a real-money pilot remain gated. Capture the verifier and merchant operator identities, test network, allowed and denied proof results, and independently finalized payer, recipient, asset, amount and sponsor before enabling a pilot.

## Recover an uncertain payment

On the signing service, reopen the same SpendingLedger after restart and call reconcile with the reservation ID, original payment policy, and candidate transaction hash. Supply an independent finalized-chain verifier that checks the network, asset, amount, payer, recipient, sponsor, nonce and expiry against the persisted submission. An unconfirmed or mismatched transaction leaves the reservation in place. A confirmed transaction updates the receipt without issuing a payment. The operation is idempotent for the same finalized hash.
