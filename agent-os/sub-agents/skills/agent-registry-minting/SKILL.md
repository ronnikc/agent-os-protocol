Title: Agent Registry Minting
Keywords: concordium, agent-registry, cis-8004, agent-card, minting, build-register, metadata-hash, did-ccd, set-agent-uri, mcp-service
Agents: backend, api, infrastructure, frontend
When to use: When anchoring an Agent Card on the Concordium CIS-8004 Agent Registry — building the register/update payload (via the Agent Registry MCP service), hosting the card, and diagnosing on-chain contract rejections.
Version: 1.0.0
Last updated: 2026-07-04

Mint or update an agent identity on the CIS-8004 Agent Registry so a `did:ccd:<network>:<id>` resolves to a hosted, hash-matched Agent Card. The service (or SDK) builds a sign-ready payload; the owner's wallet signs and submits — the app never holds keys. Encodes the two failure modes seen in the Agent OS lobby: the **metadata-hash mismatch** (card hashed before the signature was added, then hosted with it) and the **wrong-entrypoint rejection** (`register` vs `setAgentURI`).

---

## Workflow

### Step 1 — Author and validate the Agent Card
Draft the card (`@agent-os/identity-concordium` `draftAgentCard`), run `validateAgentCard`, and assert it carries **no secret**. Decide the card's canonical, hosted form now — the bytes you host are the bytes you must hash in Step 3.

### Step 2 — Build the sign-ready payload via the registry MCP service
POST the card + owner account to the Agent Registry MCP service (`AGENT_OS_AGENT_REGISTRY_MCP_URL`, e.g. `build_register`). It returns `{ parameter_hex, parameter_json, contract_address, receive_name, schema_b64 }`. Map the minting account field defensively — the live service names it `sender` (also accept `owner`/`account`/`address`). The service builds the payload; it never signs.

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
Hand the built payload to `concordium-wallet-integration` (Step 4/5) to submit as an `AccountTransactionType.Update`, or — preferred — via the registry's **sponsored/permit** path so Concordium pays the energy instead of the owner's wallet. On finalization, derive `did:ccd:<network>:<agent-id>` and persist it as the agent's identity/join token. Verify read-only with `identity-verification`.

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

- Contract rejects with `-2147483648` (concordium-std default `Reject`) → a parameter parse error or a failed `ensure!` precondition. Re-check: entrypoint (`register` vs `setAgentURI`), parameter matches `schema_b64`, and the account is permitted to register. Log the built `parameter_hex`/`parameter_json` and diff against the schema.
- Resolver reports the card as tampered / hash mismatch → Step 3 was violated; re-hash the exact hosted bytes.
- MCP service field for the minting account is absent → map `sender`/`owner`/`account`/`address` defensively.
- Owner's wallet is charged energy for what should be free → use the sponsored/permit path (see `concordium-wallet-integration` Step 5).
- `AGENT_OS_AGENT_REGISTRY_MCP_URL` empty → off-chain mode; build the payload locally and skip submission, or prompt the operator to configure the service.
