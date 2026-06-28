Title: Identity Verification
Keywords: agent-identity, concordium, agent-card, verification, accountability, lobby-policy
Slug: identity-verification
Scope: Draft/validate an Agent Card and verify a non-secret registry reference (read-only, no keys)
Last updated: Phase 8

Owns the rules for **accountable agent identity**: authoring a public Agent Card, linking a local
profile to a non-secret registry reference, verifying that reference read-only, and choosing the
right private-lobby join policy. Drives `@agent-os/identity-concordium`. Accountability, not
doxxing — prove the anchor without exposing the human (IMPLEMENTATION-PLAN.md §10).

---

## Rules

- **Never** handle a private key, wallet seed, or signed transaction. References (`did:ccd:…`) and
  cards are public; on-chain writes are wallet-side and deferred.
- A **display name is not an identity** — only a verified `join_token` (the registry ref) is.
- Verification is **read-only** through an injectable transport (indexer/API). `pending` means the
  source was unreachable (indeterminate) — it never counts as verified; policies fail closed.
- Status ladder (weak → strong): `unverified` → `pending` → `registry_verified` → `human_linked`
  (VCK) → `org_linked` (VCDC); `failed` = not found / revoked / malformed.
- A card must pass `validateAgentCard` and carry no secret before it is linked or registered.

## How

```ts
import {
  draftAgentCard, validateAgentCard, hashAgentCard, linkProfile,
  IdentityVerifier, HttpIndexerTransport, prepareRegistration,
} from '@agent-os/identity-concordium';

const card = draftAgentCard({ name: 'Backend Reviewer', description: '…', runtime: 'claude-cli', capabilities: ['code-review'] });
if (!validateAgentCard(card).ok) throw new Error('fix the card first');

const verifier = new IdentityVerifier({ transport: new HttpIndexerTransport({ baseUrl: process.env.AGENT_OS_CONCORDIUM_INDEXER_URL! }) });
const result = await verifier.verify('did:ccd:mainnet:…');   // → { status, humanLinked, … }

const plan = prepareRegistration(card);   // non-submitting: card + hash + wallet-side steps
```

Pick the lobby policy to match the trust you need: `none` (open) · `registered` (any resolvable
ref) · `allowlisted` (explicit list) · `verified_human_link` (VCK/VCDC). The lobby coordinator
enforces it server-side.

## Acceptance

- `validateAgentCard` passes and `hashAgentCard` is deterministic (order-independent).
- A known-verified ref resolves to the expected status; an unknown ref → `failed`; an unreachable
  source → `pending` (never a false verify).
- `prepareRegistration` returns a wallet-side-only plan and never signs or submits.
- `npm run verify-identity` is green.
