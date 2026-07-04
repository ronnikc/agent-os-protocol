Title: Concordium Wallet Integration
Keywords: concordium, wallet, browser-wallet, web-sdk, ccd, balance, account-transaction, sponsored-transaction, cis-3, did-ccd
Agents: frontend, backend, api, infrastructure
When to use: When a browser app must detect a Concordium wallet, read an account balance, or build and submit an Update (smart-contract) transaction through the user's wallet — including sponsored (gasless) transactions.
Version: 1.0.0
Last updated: 2026-07-04

Integrate a Concordium browser wallet the right way: detect the provider, read balances without NaN, and build **real SDK-typed** transaction payloads so `sendTransaction` serializes correctly. Encodes the hard-won failure modes from the Agent OS lobby wallet work (NaN balance, `A.mod is not a function`, gas paid by the user instead of the sponsor). Keys never leave the wallet — the app only ever assembles payloads and calls the wallet to sign.

---

## Workflow

### Step 1 — Detect the wallet provider
Use the Browser Wallet API, not a bespoke injection. Prefer `@concordium/browser-wallet-api-helpers` `detectConcordiumProvider()` (resolves when the extension injects, rejects on timeout); fall back to `window.concordium` only as a legacy probe. Request accounts with `provider.connect()` / `provider.requestAccounts()` and keep the returned account address string — that is the sender for every transaction.

### Step 2 — Load the real SDK, never hand-roll serialization
Dynamically import the versioned SDK (`@concordium/web-sdk@12`, e.g. `await import('https://esm.sh/@concordium/web-sdk@12')` in a no-build browser app). Build **actual SDK instances** for every payload field:
- `CcdAmount.fromMicroCcd(0n)` for amount
- `ContractAddress.create(index, subindex)` for the contract
- `ReceiveName.fromString('<contract>.<entrypoint>')`
- `Energy.create(maxEnergy)`
- `Parameter.fromHexString(hex)` for the serialized parameter

Passing plain numbers/objects/hex strings where the SDK expects class instances is what throws `A.mod is not a function` at submit time — the wallet's serializer calls BigInt/Buffer methods on those instances. Match the SDK major version to the wallet.

### Step 3 — Read balance defensively (avoid NaN)
The wallet-proxy / gRPC returns `finalizedBalance` (and `accountAmount`) as a **structured amount**, not a plain number. `Number(obj)` → `NaN`. Coerce through the SDK: `CcdAmount.toMicroCcd(amount)` (or read `amount.microCcdAmount` / `amount.value`) and only then divide by `1_000_000n` for display. Use a strategy chain — browser-wallet API → wallet-proxy REST → gRPC — and fall back to an explicit "balance unavailable" string; never let a coercion failure render `NaN`.

### Step 4 — Build and submit the Update transaction
Assemble the payload from Step 2 instances and submit:
```js
const txHash = await provider.sendTransaction(
  senderAddress,
  AccountTransactionType.Update,          // === 2
  { amount, address, receiveName, message, maxContractExecutionEnergy: energy },
);
```
Log the exact payload (contract, entrypoint, hex, energy) before submit so a contract rejection can be diagnosed against the parameter. Surface `txHash` and poll finalization; render explorer link `<explorer>/transaction/<txHash>`.

### Step 5 — Prefer sponsored (gasless) transactions when the contract supports them
If the target contract implements CIS-3 sponsored transactions / a `permit` entrypoint (the hosted Concordium registries do), the user signs a **message** and a sponsor account submits + pays the energy. Build the CIS-3 `permit` message (nonce from the contract's `nonceOf`, signature over the message), call the sponsor's submit endpoint with `{ signature, signer, message }` instead of `sendTransaction`. This spends 0 CCD from the user's wallet. Only fall back to a direct `AccountTransactionType.Update` (user pays energy) when no sponsor/permit path exists.

---

## Input Schema

```yaml
input:
  operation:
    type: string
    required: true
    enum: [detect, read_balance, build_update, submit_update, sponsored_permit]
    description: "Which wallet operation to perform"
  contract_address:
    type: object
    required: false
    properties:
      index: { type: integer }
      subindex: { type: integer }
    description: "Target smart contract (<index,subindex>) for build/submit"
  receive_name:
    type: string
    required: false
    description: "'<contractName>.<entrypoint>' for the Update call"
  parameter_hex:
    type: string
    required: false
    description: "Serialized parameter as hex (from a build service or SDK serializer)"
  max_energy:
    type: integer
    required: false
    default: 30000
    description: "Max contract execution energy"
  sdk_version:
    type: string
    required: false
    default: "12"
    description: "@concordium/web-sdk major version, must match the wallet"
```

## Output Schema

```yaml
output:
  wallet:
    type: object
    properties:
      detected: { type: boolean }
      account: { type: string }        # sender address, or "" if not connected
  balance:
    type: object
    properties:
      micro_ccd: { type: string }      # bigint as string, never NaN
      display_ccd: { type: string }    # e.g. "4.732978" or "balance unavailable"
  transaction:
    type: object
    properties:
      submitted: { type: boolean }
      tx_hash: { type: string }
      sponsored: { type: boolean }     # true when energy was paid by a sponsor
      explorer_url: { type: string }
```

## Quality Gate

- Every `sendTransaction` payload field is a real SDK instance (`CcdAmount`/`ContractAddress`/`ReceiveName`/`Energy`/`Parameter`), never a raw number/object/hex — verified no `A.mod is not a function` at submit.
- Balance is coerced via `toMicroCcd()` (or `.microCcdAmount`) and can never render `NaN`; an unreachable source degrades to "balance unavailable".
- The loaded `@concordium/web-sdk` major version matches the connected wallet.
- No private key, seed, or signed transaction is ever read, stored, or logged by the app.
- The exact payload (contract, entrypoint, hex, energy) is logged before submit for rejection diagnosis.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "concordium-wallet-integration"
  stage: "S1"
  suggested_next:
    - slug: "agent-registry-minting"
      stage: "S1"
      reason: "Once the wallet can sign an Update, mint/anchor an Agent Card on the CIS-8004 registry"
    - slug: "identity-verification"
      stage: "S4"
      reason: "Verify the resulting did:ccd registry reference read-only for lobby policy"
```

## Error Handling

- `detectConcordiumProvider()` rejects on timeout → the extension is missing/locked; prompt the user to install/unlock rather than falling through to `window.concordium` blindly.
- `A.mod is not a function` / serialization TypeError at submit → a payload field is not an SDK instance; rebuild it via the Step 2 constructors and confirm the SDK version.
- Balance renders `NaN` → the source returned a structured amount; coerce with `toMicroCcd()` instead of `Number()`.
- `sendTransaction` rejected by the user → surface a cancel state, do not retry automatically.
- Contract rejects the Update on-chain → this is a parameter/precondition failure, not a wallet bug; hand off to `agent-registry-minting` error handling with the logged payload.
