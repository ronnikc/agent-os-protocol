Title: Agent Registry Minting
Keywords: concordium, agent-registry, cis-8004, agent-card, minting, build-register, metadata-hash, did-ccd, set-agent-uri, mcp-service
Agents: backend, api, infrastructure, frontend
When to use: When anchoring an Agent Card on the Concordium CIS-8004 Agent Registry — building the register/update payload (via the Agent Registry MCP service), hosting the card, and diagnosing on-chain contract rejections.
Version: 1.3.0
Last updated: 2026-07-05

Mint or update an agent identity on the CIS-8004 Agent Registry so a `did:ccd:<network>:<id>` resolves to a hosted, hash-matched Agent Card. The service (or SDK) builds a sign-ready payload; the owner's wallet signs and submits — the app never holds keys. Encodes the two failure modes seen in the Agent OS lobby: the **metadata-hash mismatch** (card hashed before the signature was added, then hosted with it) and the **wrong-entrypoint rejection** (`register` vs `setAgentURI`).

---

## Workflow

### Step 1 — Author and validate the Agent Card
Draft the card (`@agent-os/identity-concordium` `draftAgentCard`), run `validateAgentCard`, and assert it carries **no secret**. Decide the card's canonical, hosted form now — the bytes you host are the bytes you must hash in Step 3.

### Step 2 — Build the sign-ready payload via the registry MCP service
POST the card + owner account to the Agent Registry MCP service (`AGENT_OS_AGENT_REGISTRY_MCP_URL`, e.g. `build_register`). It returns `{ parameter_hex, parameter_json, contract_address, receive_name, schema_b64 }`. Map the minting account field defensively — the live service names it `sender` (also accept `owner`/`account`/`address`). The service builds the payload; it never signs.

**`build_register` is type-strict — map by declared JSON type, never by name alone.** Its input schema is `{ sender (string, required), agent_uri (string|null), metadata_hash_hex (string|null, pattern ^[0-9a-fA-F]{64}$), external_reference (OBJECT|null), initial_metadata (ARRAY|null of {key, value_hex}), network (enum devnet|testnet|mainnet, default devnet) }`. The bug that produces `build_register call failed`: a name-only mapper stuffs the metadata **URL** into `initial_metadata` (its name matches `/metadata/`) and the agent **DID** into `external_reference` (matches `/external.*ref/`) — but those are an array and an object, so the contract rejects the malformed parameter. Correct mapping for a new mint: `{ sender: owner, agent_uri: hostUrl, metadata_hash_hex: sha256hex, network: 'mainnet' }` and **omit** `external_reference`/`initial_metadata` (the service defaults them to None/empty, exactly as every successful on-chain register event does). Always send `network` explicitly — the schema default is `devnet`, not your live network.

### Step 3 — Freeze the metadata hash against the hosted bytes (critical)
`parameter` carries a `metadata_hash` (sha256 of the hosted card). The hash MUST be computed over the **exact document you will host**. The classic bug: hash the sorted card, then append `signature`/`signedBy` to the object, then host the now-larger object — the on-chain hash no longer matches the hosted content, so resolvers reject the card as tampered.
Fix one of two ways, consistently:
- **Host-then-hash:** finalize the card (including any signature fields), then `metadata_hash = sha256(hostedBytes)`; or
- **Hash-without-signature:** host the card **without** signature fields and hash that exact form.
Never hash one shape and host another.

### Step 4 — Choose the correct entrypoint
The registry distinguishes creation from update:
- **`register`** — first-time creation of a new agent entry (fails if preconditions aren't met, e.g. entry exists, wrong parameter shape, or issuance rules).
- **`setAgentURI`** — update the metadata URI/hash of an **already-registered** agent (this is the entrypoint the successful on-chain events use for ongoing updates).
Pick `register` only for a genuinely new mint with a parameter that matches the module schema exactly; use `setAgentURI` to re-point or re-hash an existing agent. A `register` call on the wrong precondition is the common source of the `-2147483648` reject.

### Step 5 — Submit via wallet (or sponsor) and record the DID
Hand the built payload to `concordium-wallet-integration` (Step 4/5) to submit as an `AccountTransactionType.Update`, or — preferred — via the **sponsor service** so Concordium pays the energy instead of the owner's wallet. The sponsor service (`AGENT_OS_REGISTRY_SPONSOR_URL`, default `https://registry-sponsor-service.concordium.com/sponsor`) is a plain HTTP relay, separate from the MCP builder: `POST /sponsor { genesisHash, payload: <unsigned Transaction.JSON>, sender: <base58>, nonce: <int > 0> }` → **partially-signed** Transaction.JSON with the sponsor's co-signature attached, which the owner's wallet completes and submits. In Agent OS the lobby proxies this at `POST /api/v1/agent-lobby/registry/sponsor` (no keys pass through; the unsigned payload is relayed verbatim) and advertises availability via `registry/status.sponsored`. On finalization, derive `did:ccd:<network>:<agent-id>` and persist it as the agent's identity/join token. Verify read-only with `identity-verification`.

---

## Input Schema

```yaml
input:
  agent_card:
    type: object
    required: true
    description: "Validated, secret-free Agent Card to anchor"
  owner_account:
    type: string
    required: true
    description: "Concordium account that will sign (the sender)"
  mode:
    type: string
    required: true
    enum: [register, set_agent_uri]
    description: "First-time mint vs update of an existing agent entry"
  registry_mcp_url:
    type: string
    required: false
    description: "AGENT_OS_AGENT_REGISTRY_MCP_URL; empty = off-chain (build locally)"
  host_url:
    type: string
    required: true
    description: "Where the card is/will be hosted (must match the hashed bytes)"
  sponsored:
    type: boolean
    required: false
    default: true
    description: "Prefer the sponsored/permit path so the owner pays no energy"
```

## Output Schema

```yaml
output:
  payload:
    type: object
    properties:
      contract_address: { type: string }   # "<index,subindex>"
      receive_name: { type: string }        # "<contract>.<entrypoint>"
      parameter_hex: { type: string }
      metadata_hash_hex: { type: string }
  hosted:
    type: object
    properties:
      url: { type: string }
      hash_matches: { type: boolean }        # sha256(hosted bytes) === metadata_hash_hex
  result:
    type: object
    properties:
      tx_hash: { type: string }
      did: { type: string }                  # did:ccd:<network>:<id>
      sponsored: { type: boolean }
```

## Quality Gate

- `metadata_hash_hex` equals `sha256` of the **exact hosted bytes** — hash and host the same shape (signature-in or signature-out, not mixed).
- Entrypoint matches intent: `register` only for a new entry with a schema-correct parameter; `setAgentURI` for updates.
- The MCP-built parameter validates against the module `schema_b64` before submit.
- No key/seed is read or logged; signing is wallet- or sponsor-side only.
- On success the `did:ccd` resolves read-only to the hosted, hash-matched card (`identity-verification` green).

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "agent-registry-minting"
  stage: "S1"
  suggested_next:
    - slug: "identity-verification"
      stage: "S4"
      reason: "Verify the minted did:ccd reference read-only and set the lobby join policy"
    - slug: "concordium-wallet-integration"
      stage: "S1"
      reason: "Submit the built payload (sponsored or direct Update) through the wallet"
```

## Error Handling

- `build_register call failed` / contract rejects with `-2147483648` (concordium-std default `Reject`) → a parameter parse error or a failed `ensure!` precondition. **First suspect a type-mismatched register arg** (Step 2): confirm `external_reference`/`initial_metadata` are omitted (not fed a DID/URL string) and `network` is your live network, not the `devnet` default. Then re-check: entrypoint (`register` vs `setAgentURI`), parameter matches `schema_b64`, and the account is permitted to register. Log the built `parameter_hex`/`parameter_json` and diff against the schema.
- **On-chain reject `-2147483648` with an EMPTY `messageAsHex` (energy cost only ~800)** → the transaction was submitted with **no parameter bytes**. The classic cause: the builder returns `{ hex, schema_json }` (docs) — hex is the wire-encoded parameter — but the client instead took a "parameters JSON + schema" wallet path and passed **`schema_json` (a JSON schema type) where the wallet expects a base64 module schema**, so the wallet serialized an empty parameter. Fix: prefer the builder's `hex` as the update `message` (`Parameter.fromHexString(hex)`); only use the wallet's JSON+schema path with a **genuine base64** schema; otherwise serialize client-side with the SDK. **Always guard `Parameter.toBuffer(message).length > 0` before submitting** — an empty parameter is a guaranteed reject that still burns energy (~4 CCD).
- **A submitted tx is not a confirmed mint.** The wallet returns a tx hash at *submission*; the contract can still reject at finalization. Never report success on the hash alone — poll the outcome (CCDScan `transactionByTransactionHash.result`, or gRPC `getBlockItemStatus`) and only claim the DID is anchored once it finalizes as a success. CCDScan mainnet GraphQL: `POST https://api-ccdscan.mainnet.concordium.software/api/graphql`.
- **`register` on the mainnet CIS-8004 registry (contract `<10082,0>`) is SPONSOR-GATED — a self-paid register ALWAYS rejects (-2147483648, ~800 NRG), a correct parameter notwithstanding.** Verified on-chain: every successful `register` (including from an ordinary user account) carries `sponsorAccountAddress = 3z9dkoTn…` (the `registry-sponsor-service`); every self-paid one is rejected by contract policy. So the sponsor service is **mandatory**, not just gasless. Diagnose by comparing a failed vs a successful register on CCDScan (`transactionByTransactionHash{ senderAccountAddress sponsorAccountAddress result }`) — identical 122-byte params, opposite outcomes, the only difference being the sponsor.
- **The injected browser wallet (`window.concordium`) cannot complete a sponsored transaction.** Its API is only `sendTransaction` (self-signs + self-submits its own tx; the wallet builds the header) and `signMessage` (prepends 8 zero-bytes + address so it can NEVER be a valid tx signature). Completing a sponsor-co-signed `Transaction.JSON` (sponsor signs → sender signs → submit) requires the **WalletConnect + grpc-web** path the official `agent-registry.concordium.com` UI uses (WalletConnect for the sender signature, `ConcordiumGRPCWebClient` on `grpc.<net>.concordium.software:20000` for nonce + submission), plus `POST registry-sponsor-service.concordium.com/sponsor { genesisHash, payload:<unsigned Transaction.JSON>, sender, nonce }`. Mainnet genesisHash: `9dd9ca4d19e9393877d2c44b70f89acbfc0883c2243e5eeaecc0d1cd0503f478`; nonce via `wallet-proxy.mainnet.concordium.software/v0/accNonce/<addr>`. **Never auto-submit a self-paid register on a sponsor-gated registry — it burns CCD on a certain reject.**
- Resolver reports the card as tampered / hash mismatch → Step 3 was violated; re-hash the exact hosted bytes.
- MCP service field for the minting account is absent → map `sender`/`owner`/`account`/`address` defensively.
- Owner's wallet is charged energy for what should be free → use the sponsored/permit path (see `concordium-wallet-integration` Step 5).
- `AGENT_OS_AGENT_REGISTRY_MCP_URL` empty → off-chain mode; build the payload locally and skip submission, or prompt the operator to configure the service.
