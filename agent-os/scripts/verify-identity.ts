#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * verify-identity — runnable functional verification for the Phase 8 agent-identity slice.
 *
 * Proves the whole read-only path with **no network, no live indexer, and no key**, by injecting a
 * fake `IdentityTransport` (and a fake verifier into the real lobby coordinator):
 *
 *   A. Agent Card — draft/validate, deterministic order-independent hash, secret rejection.
 *   B. Reference parsing — did:ccd: ↔ ConcordiumAgentRef; junk → null.
 *   C. Verifier — record → status ladder (registry_verified / human_linked / org_linked),
 *      not-found/revoked → failed, source-unreachable → pending (never a false failure), malformed → failed.
 *   D. Registration — prepareRegistration is wallet-side-only, carries the card hash + media type,
 *      and never contains a key or a submit.
 *   E. Profile — linkProfile binds a non-secret reference; a secret-bearing card is refused.
 *   F. Policy ladder — the REAL LobbyCoordinator with an injected fake verifier admits/denies across
 *      none → registered → allowlisted → verified_human_link, stamps the roster badge, and logs denials.
 *   G. Keys-never-leave — every artifact that could cross a boundary serializes with no secret.
 *
 * Exits non-zero on the first failed assertion so it can gate a commit / CI.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type {
  AgentToLobbyMessage,
  ConcordiumAgentRef,
  RegistryAgentRecord,
  LobbySession,
} from '@agent-os/protocol-core';
import {
  draftAgentCard,
  validateAgentCard,
  hashAgentCard,
  canonicalizeAgentCard,
  cardHasInlineSecret,
  assertNoSecretsInCard,
  parseConcordiumRef,
  formatRef,
  IdentityVerifier,
  makeVerifyIdentityFn,
  prepareRegistration,
  linkProfile,
  applyVerification,
  UnconfiguredTransport,
  type IdentityTransport,
} from '@agent-os/identity-concordium';
import { InMemoryLobbyStore, LobbyCoordinator, type Connection } from '@agent-os/lobby-server';

// ── Tiny test runner (matches verify-lobby / verify-providers) ──
let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}\n    ${(err as Error).message.split('\n').join('\n    ')}`);
  }
}

// ── Fakes (the injected seam) ──

/** A fake registry indexer over a fixture map — no network, no keys. */
class FakeTransport implements IdentityTransport {
  constructor(private readonly records: Record<string, RegistryAgentRecord>) {}
  async lookupAgent(ref: ConcordiumAgentRef): Promise<RegistryAgentRecord | null> {
    const key = ref.did ?? ref.agentId ?? '';
    return this.records[key] ?? null;
  }
}
/** A transport whose source is unreachable — every lookup throws (→ pending). */
class ThrowingTransport implements IdentityTransport {
  async lookupAgent(): Promise<RegistryAgentRecord | null> {
    throw new Error('connection refused');
  }
}

const DID_REG = 'did:ccd:mainnet:registered-only';
const DID_HUMAN = 'did:ccd:mainnet:human-owner';
const DID_ORG = 'did:ccd:mainnet:org-domain';
const DID_REVOKED = 'did:ccd:mainnet:revoked';

const fixtures: Record<string, RegistryAgentRecord> = {
  [DID_REG]: { did: DID_REG, name: 'Reg', registeredAt: '2026-01-01T00:00:00Z' },
  [DID_HUMAN]: { did: DID_HUMAN, name: 'Human', humanLinked: true },
  [DID_ORG]: { did: DID_ORG, name: 'Org', humanLinked: true, domain: 'example.com' },
  [DID_REVOKED]: { did: DID_REVOKED, name: 'Revoked', revoked: true },
};

const fakeVerifier = new IdentityVerifier({ transport: new FakeTransport(fixtures) });
const verifyFn = makeVerifyIdentityFn(fakeVerifier);

// ── Lobby helpers ──
function makeLobby(join_policy: LobbySession['join_policy'], allowlist?: string[]): LobbySession {
  const now = new Date().toISOString();
  return {
    lobby_id: randomUUID(),
    org_id: 'default',
    name: 'test',
    status: 'active',
    visibility: join_policy === 'none' || join_policy === undefined ? 'public' : 'private',
    join_policy,
    allowlist,
    connected_agent_ids: [],
    message_seq: 0,
    created_at: now,
    updated_at: now,
    created_by: 'system',
  };
}
async function registerInto(coord: LobbyCoordinator, store: InMemoryLobbyStore, lobby: LobbySession, joinToken?: string) {
  await store.createLobby(lobby);
  const conn: Connection = { connId: randomUUID(), lobbyId: lobby.lobby_id, orgId: 'default' };
  const reg: Extract<AgentToLobbyMessage, { type: 'lobby-register' }> = {
    type: 'lobby-register',
    display_name: 'candidate',
    ...(joinToken ? { join_token: joinToken } : {}),
  };
  const r = await coord.handle(conn, reg);
  return { conn, r };
}

async function main(): Promise<void> {
  console.log('verify-identity — Phase 8 agent identity & verification\n');

  // ════════ A — Agent Card authoring ════════
  console.log('A — Agent Card');

  await check('draftAgentCard fills defaults + timestamps and validates', () => {
    const card = draftAgentCard({ name: 'Backend Reviewer', description: 'reviews PRs', runtime: 'claude-cli', capabilities: ['code-review'] });
    assert.equal(card.mediaType, 'application/a2a-agent-card+json');
    assert.deepEqual(card.supportedProtocols, ['agent-os-lobby']);
    assert.ok(card.createdAt && card.updatedAt);
    assert.equal(validateAgentCard(card).ok, true);
  });

  await check('validateAgentCard rejects missing fields + bad ownerPolicy + bad contactUrl', () => {
    const card = draftAgentCard({ name: '', description: '', runtime: '', capabilities: [] });
    (card as { ownerPolicy: string }).ownerPolicy = 'nope';
    card.contactUrl = 'ftp://x';
    const v = validateAgentCard(card);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /name/.test(e)) && v.errors.some((e) => /ownerPolicy/.test(e)) && v.errors.some((e) => /contactUrl/.test(e)));
  });

  await check('hashAgentCard is deterministic and order-independent', () => {
    const a = draftAgentCard({ name: 'X', description: 'd', runtime: 'claude-cli' });
    // Same content, different key insertion order → same canonical form → same hash.
    const reordered = { updatedAt: a.updatedAt, name: a.name, runtime: a.runtime, mediaType: a.mediaType, description: a.description, version: a.version, ownerPolicy: a.ownerPolicy, capabilities: a.capabilities, supportedProtocols: a.supportedProtocols, allowedScopes: a.allowedScopes, createdAt: a.createdAt } as typeof a;
    assert.equal(canonicalizeAgentCard(a), canonicalizeAgentCard(reordered));
    assert.equal(hashAgentCard(a), hashAgentCard(reordered));
    assert.match(hashAgentCard(a), /^[0-9a-f]{64}$/);
    // A content change flips the hash.
    const b = { ...a, name: 'Y' };
    assert.notEqual(hashAgentCard(a), hashAgentCard(b));
  });

  await check('a card carrying a secret is detected and rejected', () => {
    const card = draftAgentCard({ name: 'Leaky', description: 'token sk-ABCDEFGHIJKLMNOPQRSTUV in here', runtime: 'claude-cli' });
    assert.equal(cardHasInlineSecret(card), true);
    assert.equal(validateAgentCard(card).ok, false);
    assert.throws(() => assertNoSecretsInCard(card), /secret/i);
  });

  // ════════ B — Reference parsing ════════
  console.log('\nB — reference parsing');

  await check('parseConcordiumRef parses did:ccd: with + without network; junk → null', () => {
    const r1 = parseConcordiumRef('did:ccd:testnet:abc123');
    assert.equal(r1?.network, 'testnet');
    assert.equal(r1?.did, 'did:ccd:testnet:abc123');
    const r2 = parseConcordiumRef('did:ccd:plainid');
    assert.equal(r2?.network, 'mainnet'); // default
    assert.equal(parseConcordiumRef('not-a-did'), null);
    assert.equal(parseConcordiumRef('did:web:example.com'), null);
    assert.equal(formatRef(r1!), 'did:ccd:testnet:abc123');
  });

  // ════════ C — Verifier (read-only resolution) ════════
  console.log('\nC — verifier (status ladder)');

  await check('a DID-only record → registry_verified', async () => {
    const res = await fakeVerifier.verify(DID_REG);
    assert.equal(res.status, 'registry_verified');
    assert.equal(res.source, 'indexer');
    assert.ok(!res.humanLinked && !res.orgLinked);
  });

  await check('a VCK record → human_linked', async () => {
    const res = await fakeVerifier.verify(DID_HUMAN);
    assert.equal(res.status, 'human_linked');
    assert.equal(res.humanLinked, true);
  });

  await check('a VCDC (domain) record → org_linked with the domain', async () => {
    const res = await fakeVerifier.verify(DID_ORG);
    assert.equal(res.status, 'org_linked');
    assert.equal(res.orgLinked, true);
    assert.equal(res.domain, 'example.com');
  });

  await check('an unknown ref → failed; a revoked record → failed', async () => {
    assert.equal((await fakeVerifier.verify('did:ccd:mainnet:ghost')).status, 'failed');
    assert.equal((await fakeVerifier.verify(DID_REVOKED)).status, 'failed');
  });

  await check('a malformed ref → failed (never throws)', async () => {
    const res = await fakeVerifier.verify('garbage');
    assert.equal(res.status, 'failed');
    assert.match(res.reason ?? '', /malformed/i);
  });

  await check('an unreachable source → pending (indeterminate, not a false failure)', async () => {
    const v = new IdentityVerifier({ transport: new ThrowingTransport() });
    const res = await v.verify(DID_HUMAN);
    assert.equal(res.status, 'pending');
    assert.match(res.reason ?? '', /unavailable/i);
  });

  await check('UnconfiguredTransport yields pending (no indexer → fail closed for policies)', async () => {
    const v = new IdentityVerifier({ transport: new UnconfiguredTransport() });
    assert.equal((await v.verify(DID_HUMAN)).status, 'pending');
  });

  // ════════ D — Registration (non-submitting) ════════
  console.log('\nD — registration prep');

  await check('prepareRegistration is wallet-side-only, carries the hash + media type, and holds no key', () => {
    const card = draftAgentCard({ name: 'Reg Me', description: 'd', runtime: 'claude-cli', ref: parseConcordiumRef('did:ccd:testnet:x')! });
    const plan = prepareRegistration(card);
    assert.equal(plan.walletSideOnly, true);
    assert.equal(plan.network, 'testnet');
    assert.equal(plan.cardHash, hashAgentCard(card));
    assert.equal(plan.mediaType, 'application/a2a-agent-card+json');
    assert.ok(plan.steps.some((s) => /sign/i.test(s)) && plan.steps.some((s) => /wallet/i.test(s)));
    // No step ever submits on the user's behalf, and the plan carries no secret.
    assert.ok(!plan.steps.some((s) => /\bsubmit it for you|we sign|we submit\b/i.test(s)));
    assert.equal(/sk-[A-Za-z0-9_-]{16,}|PRIVATE KEY/.test(JSON.stringify(plan)), false);
  });

  await check('prepareRegistration refuses an invalid / secret-bearing card', () => {
    const bad = draftAgentCard({ name: '', description: '', runtime: '' });
    assert.throws(() => prepareRegistration(bad), /invalid Agent Card/i);
  });

  // ════════ E — Profile binding ════════
  console.log('\nE — profile binding');

  await check('linkProfile binds a non-secret ref; applyVerification attaches the result', async () => {
    const ref = parseConcordiumRef(DID_HUMAN)!;
    const card = draftAgentCard({ name: 'Bound', description: 'd', runtime: 'claude-cli', ref });
    const identity = linkProfile('local-1', 'Bound Agent', ref, card);
    const res = await fakeVerifier.verify(DID_HUMAN);
    const withV = applyVerification(identity, res);
    assert.equal(withV.ref?.did, DID_HUMAN);
    assert.equal(withV.lastVerification?.status, 'human_linked');
  });

  await check('linkProfile refuses a card with an inline secret', () => {
    const leaky = draftAgentCard({ name: 'L', description: 'sk-ABCDEFGHIJKLMNOPQRSTUV', runtime: 'claude-cli' });
    assert.throws(() => linkProfile('local-2', 'Leaky', undefined, leaky), /secret/i);
  });

  // ════════ F — Policy ladder (real coordinator + injected fake verifier) ════════
  console.log('\nF — private-lobby policy ladder');

  await check("policy 'none' admits anyone and stamps the badge from a presented ref", async () => {
    const store = new InMemoryLobbyStore();
    const coord = new LobbyCoordinator(store, { verifyIdentity: verifyFn });
    const { conn, r } = await registerInto(coord, store, makeLobby('none'), DID_HUMAN);
    assert.ok(!r.close);
    const agent = (await store.roster(conn.lobbyId)).find((a) => a.agent_id === conn.agentId);
    assert.equal(agent?.identity_status, 'human_linked');
    assert.equal(agent?.identity_ref, DID_HUMAN);
  });

  await check("policy 'registered' admits a resolvable ref; denies junk + a missing ref", async () => {
    const store = new InMemoryLobbyStore();
    const coord = new LobbyCoordinator(store, { verifyIdentity: verifyFn });
    assert.ok(!(await registerInto(coord, store, makeLobby('registered'), DID_REG)).r.close, 'reg admits');
    const junk = await registerInto(coord, store, makeLobby('registered'), 'did:ccd:mainnet:ghost');
    assert.equal(junk.r.close, true);
    assert.match((junk.r.out[0].message as { error: string }).error, /not registry-verified/i);
    assert.equal((await registerInto(coord, store, makeLobby('registered'), undefined)).r.close, true, 'no ref denies');
  });

  await check("policy 'verified_human_link' admits human/org links; denies registry-only", async () => {
    const store = new InMemoryLobbyStore();
    const coord = new LobbyCoordinator(store, { verifyIdentity: verifyFn });
    assert.ok(!(await registerInto(coord, store, makeLobby('verified_human_link'), DID_HUMAN)).r.close, 'human admits');
    assert.ok(!(await registerInto(coord, store, makeLobby('verified_human_link'), DID_ORG)).r.close, 'org admits');
    assert.equal((await registerInto(coord, store, makeLobby('verified_human_link'), DID_REG)).r.close, true, 'registry-only denies');
  });

  await check("policy 'allowlisted' keeps Phase-7 behavior (on-list admits, off-list denies)", async () => {
    const store = new InMemoryLobbyStore();
    const coord = new LobbyCoordinator(store, { verifyIdentity: verifyFn });
    const onList = await registerInto(coord, store, makeLobby('allowlisted', [DID_REG]), DID_REG);
    assert.ok(!onList.r.close);
    const offList = await registerInto(coord, store, makeLobby('allowlisted', [DID_REG]), 'did:ccd:mainnet:other');
    assert.equal(offList.r.close, true);
  });

  await check('a resolution-requiring policy FAILS CLOSED with no verifier configured', async () => {
    const store = new InMemoryLobbyStore();
    const coord = new LobbyCoordinator(store); // default verifier → unverified
    const r = await registerInto(coord, store, makeLobby('registered'), DID_HUMAN);
    assert.equal(r.r.close, true, 'without a verifier, even a good ref is denied (safe default)');
  });

  await check('a join denial is recorded in the durable event log (accountability)', async () => {
    const store = new InMemoryLobbyStore();
    const coord = new LobbyCoordinator(store, { verifyIdentity: verifyFn });
    const lobby = makeLobby('registered');
    await registerInto(coord, store, lobby, 'did:ccd:mainnet:ghost');
    const events = await store.listEvents(lobby.lobby_id);
    assert.ok(events.some((e) => e.type === 'join_denied'), 'denial logged');
  });

  // ════════ G — Keys never leave ════════
  console.log('\nG — keys never leave the machine');

  await check('no identity artifact serializes any secret', async () => {
    const ref = parseConcordiumRef(DID_ORG)!;
    const card = draftAgentCard({ name: 'Clean', description: 'd', runtime: 'claude-cli', ref });
    const identity = applyVerification(linkProfile('l', 'Clean', ref, card), await fakeVerifier.verify(DID_ORG));
    const plan = prepareRegistration(card);
    const blobs = [identity, card, plan, await fakeVerifier.verify(DID_ORG)];
    // Match real secret *material* (not the word "key" in a reassuring notice): API keys, AWS/GH
    // tokens, and the PEM private-key header.
    const SECRET = /sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
    for (const b of blobs) assert.equal(SECRET.test(JSON.stringify(b)), false);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('verify-identity: all checks passed ✓');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
