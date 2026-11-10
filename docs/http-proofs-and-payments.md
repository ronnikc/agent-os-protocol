<!-- SPDX-License-Identifier: Apache-2.0 -->

# Agent IDs, x401 proofs, and x402 payments

Agent OS uses Concordium Agent IDs for roster accountability. HTTP resources can separately ask for a credential presentation through x401 or quote a payment through x402. The resource decides which checks it needs.

## Set up an agent identity and wallet

1. Use the panel's **Identity** or **Agents** view to register or link an Agent ID. For a local relay, keep the DID in its local configuration and reconnect it. For a hosted agent, save the DID in the connected repository. Merge the binding pull request if the branch is protected, then restart that agent.
2. Open the Agent ID Card from the roster. Its registry and explorer links identify the same active registration. Keep the DID when restarting or reconnecting an agent.
3. For payment experiments, [create and fund a dedicated agent account](fund-concordium-agent-wallet.md). The spending signer belongs to the agent's payment service. A recipient only supplies a receiving address.

The [mainnet operator workflow](fund-concordium-agent-wallet.md#prepare-a-mainnet-binding-or-rotation) reads a finalized wallet binding and prepares a new owner transaction. The [Phase 2 plan](agent-wallets-and-payments-plan.md) tracks panel integration and live rotation.

## x401 credential exchange

The commerce client fetches an approved HTTPS resource. If the response includes `PROOF-REQUEST`, the client parses the x401 0.2.0 challenge with the Proof SDK and asks the configured `presentProof` callback to produce a credential presentation. The callback is responsible for verifier trust, permitted attributes, and holder consent. The client retries once with `PROOF-RESPONSE`. It stops before payment if the resource rejects the presentation.

An Agent ID Card is a registry record. The service's proof request determines which issuer and credential can satisfy the x401 challenge. The repository verifies the negotiation in a fixture. A live Concordium-backed credential presentation to an independent verifier is still a release gate.

## x402 v2 sponsored payment

1. The resource returns HTTP 402 with `PAYMENT-REQUIRED`. Configure the commerce policy with the full resource URL, network, payer, recipient, asset, facilitator fee payer, and maximum amount in atomic units. For native CCD, one CCD is 1,000,000 microCCD.
2. The client accepts one matching Concordium `exact` quote. Use `requestWithSpendingLimit` and a local `SpendingLedger` to reserve against the daily budget before releasing the signer.
3. The client retries with `PAYMENT-SIGNATURE`. The facilitator verifies the transaction, signs as sponsor, and submits it. The caller's `verifySettlement` callback compares `PAYMENT-RESPONSE` with the approved quote and finalized chain data.
4. If settlement is uncertain, reconcile the recorded nonce and expiry against the chain before releasing the reservation. Use the same request ID for reconciliation and keep the signing service's ledger private.

Use a facilitator that explicitly advertises the target network and supports the quoted asset. The sponsored mainnet pilot is pending. See the [Concordium x402 exact scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_concordium.md).

## Concordium Verify & Pay pilot

Concordium also documents a transaction-hash flow. A local test resource returned HTTP 402 for 10 CCD. The QA wallet submitted the payment on mainnet and paid the network fee. The client retried with the transaction hash in `X-PAYMENT`. A local verifier checked finality, sender, recipient, and amount before granting access and rejected a replay. This evidence covers the transaction-hash flow. The sponsored v2 flow uses a different wire format and settlement path. [Concordium Verify & Pay guide](https://docs.concordium.com/en/mainnet/how-to/integrations/x402-integration.html)

## Run the repository checks

```bash
npm ci
npm run verify-identity
npm run verify-commerce
```

The commerce suite checks proof gating, quote validation, sponsored transaction construction, settlement handling, and spending reservations with test fixtures. It requires no funded account. For rollout criteria and outstanding integration work, see the [Phase 2 plan](agent-wallets-and-payments-plan.md).
