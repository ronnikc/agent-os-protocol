#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * verify-hosted — runnable verification for the Hosted Agent OS foundation (Phase 1).
 *
 * Phase 1a: provider-key custody. No live wallet / network / model — exercises the secret-box
 * crypto and the InMemoryLobbyStore-backed custody service directly:
 *
 *   A. secret-box round-trips, and GCM rejects tampering / malformed input.
 *   B. setProviderKey seals the key, returns only a masked hint (never the plaintext).
 *   C. resolveProviderKey reconstitutes the key server-side; a per-agent override beats the lobby default.
 *   D. list returns public views with no ciphertext/plaintext; revoke removes a key from resolution.
 *   E. upsert keeps one active config per (lobby, agent_ref, provider) scope.
 *   F. validation rejects bad provider ids, empty keys, and non-http base URLs.
 *
 * Exits non-zero on the first failed assertion so it can gate a commit / CI.
 */

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { AccountAddress, signMessage, buildBasicAccountSigner } from '@concordium/web-sdk';
import { InMemoryLobbyStore } from '../../packages/lobby-server/src/store.js';
import { createWalletChallenge, verifyWalletChallenge } from '../../packages/lobby-server/src/auth/wallet-signin.js';
import { assertDevBridgeNotInProduction } from '../../packages/lobby-server/src/auth/identityProof.js';
import { verifyAccountSignatureFresh, type AccountInfoSource, type CcdNetwork } from '../../packages/lobby-server/src/auth/concordium-verifier.js';
import { seal, open, keyHint, sealedKeyId, currentKeyId } from '../../packages/lobby-server/src/crypto/secret-box.js';
import {
  setProviderKey, resolveProviderKey, listProviderKeys, revokeProviderKey, toPublicView,
} from '../../packages/lobby-server/src/providers/key-custody.js';
import {
  generateNonceChallenge, verifyProofAndIssueToken, validateSessionToken, verifySignature,
} from '../../packages/lobby-server/src/auth/identityProof.js';
import { isLobbyManager, lobbyOwnerRef } from '../../packages/lobby-server/src/auth/lobbyAuthz.js';
import { HostedAgentRunner } from '../../packages/lobby-server/src/hosted/hosted-agent-runner.js';
import { createApiRuntimeAdapter } from '../../packages/adapters/src/api-runtime.js';

const ENV = { AGENT_OS_SECRET_ENCRYPTION_KEY: 'test-master-key-verify-hosted', AGENT_OS_SECRET_KEY_ID: 'v1' } as NodeJS.ProcessEnv;

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failures.push(name); console.log(`  ✗ ${name}\n      ${(err as Error).message}`); }
}

async function main(): Promise<void> {
  console.log('verify-hosted — Hosted Agent OS foundation (Phase 1a: provider-key custody)\n');

  // ── A. secret-box ──
  await check('secret-box seals and opens round-trip', () => {
    const sealed = seal('sk-ant-secret-value', ENV);
    assert.notEqual(sealed, 'sk-ant-secret-value', 'sealed value must not equal plaintext');
    assert.equal(open(sealed, ENV), 'sk-ant-secret-value');
    assert.equal(sealedKeyId(sealed), currentKeyId(ENV));
  });

  await check('secret-box rejects tampering (GCM auth) and malformed input', () => {
    const sealed = seal('abc123', ENV);
    const parts = sealed.split('.');
    parts[1] = parts[1].replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')); // flip last ciphertext hex char
    assert.throws(() => open(parts.join('.'), ENV), 'tampered ciphertext must not decrypt');
    assert.throws(() => open('not-a-sealed-value', ENV), 'malformed input must throw');
  });

  await check('secret-box under a different master key cannot open', () => {
    const sealed = seal('topsecret', ENV);
    assert.throws(() => open(sealed, { AGENT_OS_SECRET_ENCRYPTION_KEY: 'a-different-key' } as NodeJS.ProcessEnv));
  });

  await check('keyHint masks all but the last 4 chars', () => {
    assert.equal(keyHint('sk-ant-XYZ1234'), '••••1234');
    assert.ok(!keyHint('sk-ant-XYZ1234').includes('XYZ'));
  });

  // ── B. setProviderKey ──
  await check('setProviderKey stores a lobby-default key and returns no plaintext', async () => {
    const store = new InMemoryLobbyStore();
    const view = await setProviderKey(store, {
      lobbyId: 'L1', provider: 'anthropic', apiKey: 'sk-ant-lobbydefault-9999', identityRef: 'did:ccd:testnet:owner', env: ENV,
    });
    assert.equal(view.scope, 'lobby');
    assert.equal(view.agent_ref, null);
    assert.equal(view.key_hint, '••••9999');
    assert.ok(!JSON.stringify(view).includes('sk-ant-lobbydefault'), 'public view must not carry the key');
  });

  // ── C. resolve + per-agent override ──
  await check('resolveProviderKey reconstitutes the lobby default', async () => {
    const store = new InMemoryLobbyStore();
    await setProviderKey(store, { lobbyId: 'L1', provider: 'anthropic', apiKey: 'sk-ant-LOBBY', identityRef: 'o', env: ENV });
    const r = await resolveProviderKey(store, 'L1', 'anthropic', undefined, ENV);
    assert.equal(r?.apiKey, 'sk-ant-LOBBY');
    assert.equal(r?.scope, 'lobby');
  });

  await check('a per-agent override beats the lobby default; other agents fall back', async () => {
    const store = new InMemoryLobbyStore();
    await setProviderKey(store, { lobbyId: 'L1', provider: 'anthropic', apiKey: 'sk-ant-LOBBY', identityRef: 'o', env: ENV });
    await setProviderKey(store, { lobbyId: 'L1', provider: 'anthropic', apiKey: 'sk-ant-AGENT7', agentRef: 'agent-7', identityRef: 'o', env: ENV });
    const overridden = await resolveProviderKey(store, 'L1', 'anthropic', 'agent-7', ENV);
    const fallback = await resolveProviderKey(store, 'L1', 'anthropic', 'agent-other', ENV);
    assert.equal(overridden?.apiKey, 'sk-ant-AGENT7');
    assert.equal(overridden?.scope, 'agent');
    assert.equal(fallback?.apiKey, 'sk-ant-LOBBY', 'an agent with no override uses the lobby default');
  });

  await check('resolve returns null when nothing is configured for the provider', async () => {
    const store = new InMemoryLobbyStore();
    assert.equal(await resolveProviderKey(store, 'L1', 'openai', undefined, ENV), null);
  });

  // ── D. list / revoke ──
  await check('list returns public views only (no ciphertext or plaintext)', async () => {
    const store = new InMemoryLobbyStore();
    await setProviderKey(store, { lobbyId: 'L1', provider: 'anthropic', apiKey: 'sk-ant-SECRET-list', identityRef: 'o', env: ENV });
    const list = await listProviderKeys(store, 'L1');
    assert.equal(list.length, 1);
    const blob = JSON.stringify(list);
    assert.ok(!blob.includes('sk-ant-SECRET-list'), 'no plaintext in list');
    assert.ok(!('encrypted_key' in (list[0] as object)), 'no ciphertext field in public view');
  });

  await check('revoke removes a key from resolution and from the active list', async () => {
    const store = new InMemoryLobbyStore();
    const v = await setProviderKey(store, { lobbyId: 'L1', provider: 'anthropic', apiKey: 'sk-ant-REV', identityRef: 'o', env: ENV });
    await revokeProviderKey(store, v.id);
    assert.equal(await resolveProviderKey(store, 'L1', 'anthropic', undefined, ENV), null);
    assert.equal((await listProviderKeys(store, 'L1')).length, 0);
  });

  // ── E. upsert scope ──
  await check('re-setting the same scope replaces (one active config per scope)', async () => {
    const store = new InMemoryLobbyStore();
    await setProviderKey(store, { lobbyId: 'L1', provider: 'anthropic', apiKey: 'sk-ant-OLD', identityRef: 'o', env: ENV });
    await setProviderKey(store, { lobbyId: 'L1', provider: 'anthropic', apiKey: 'sk-ant-NEW', identityRef: 'o', env: ENV });
    assert.equal((await listProviderKeys(store, 'L1')).length, 1, 'only one active lobby-default config');
    assert.equal((await resolveProviderKey(store, 'L1', 'anthropic', undefined, ENV))?.apiKey, 'sk-ant-NEW');
  });

  // ── F. validation ──
  await check('validation rejects bad provider ids, empty keys, and non-http base URLs', async () => {
    const store = new InMemoryLobbyStore();
    await assert.rejects(setProviderKey(store, { lobbyId: 'L1', provider: 'bad id!', apiKey: 'k', identityRef: 'o', env: ENV }));
    await assert.rejects(setProviderKey(store, { lobbyId: 'L1', provider: 'anthropic', apiKey: '', identityRef: 'o', env: ENV }));
    await assert.rejects(setProviderKey(store, { lobbyId: 'L1', provider: 'anthropic', apiKey: 'k', baseUrl: 'ftp://x', identityRef: 'o', env: ENV }));
  });

  // ── G. Wallet session auth (Phase 1b: token hardening + proof flow) ──
  // MOCK signer contract (identityProof.verifySignature): publicKey 'MOCK_*' accepts signature
  // exactly `valid_sig_for_<nonce>`. This exercises the nonce→verify→token→validate flow offline.
  const LOBBY = 'lobby-abc';
  const WALLET = 'did:ccd:testnet:wallet-1';

  async function issueToken(store: InMemoryLobbyStore, identity = WALLET, lobby = LOBBY): Promise<string> {
    const challenge = await generateNonceChallenge(identity, lobby, store);
    const token = await verifyProofAndIssueToken(identity, `valid_sig_for_${challenge.nonce}`, 'MOCK_pubkey', lobby, store);
    if (!token) throw new Error('expected a token from a valid proof');
    return token;
  }

  await check('valid wallet proof issues a token that validates to the wallet', async () => {
    const store = new InMemoryLobbyStore();
    const token = await issueToken(store);
    const payload = validateSessionToken(token, LOBBY);
    assert.equal(payload?.identityRef, WALLET);
    assert.equal(payload?.lobbyId, LOBBY);
  });

  await check('a forged token (payload without a valid HMAC) is rejected', () => {
    // This is the exact attack the hardening closes: mint your own payload, base64 it, no real MAC.
    const forgedPayload = Buffer.from(JSON.stringify({ identityRef: 'did:ccd:testnet:attacker', lobbyId: LOBBY, expiresAt: Date.now() + 1e6 })).toString('base64url');
    assert.equal(validateSessionToken(`${forgedPayload}.deadbeef`, LOBBY), null);
    assert.equal(validateSessionToken(forgedPayload, LOBBY), null, 'a bare base64 payload (old format) must not validate');
  });

  await check('a tampered payload invalidates the token', async () => {
    const store = new InMemoryLobbyStore();
    const token = await issueToken(store);
    const [, mac] = token.split('.');
    const swapped = Buffer.from(JSON.stringify({ identityRef: 'did:ccd:testnet:attacker', lobbyId: LOBBY, expiresAt: Date.now() + 1e6 })).toString('base64url');
    assert.equal(validateSessionToken(`${swapped}.${mac}`, LOBBY), null, 'reusing a real MAC over a swapped payload must fail');
  });

  await check('a token is bound to its lobby and cannot be used for another', async () => {
    const store = new InMemoryLobbyStore();
    const token = await issueToken(store);
    assert.equal(validateSessionToken(token, 'a-different-lobby'), null);
  });

  await check('an expired nonce yields no token; a nonce cannot be replayed', async () => {
    const store = new InMemoryLobbyStore();
    const challenge = await generateNonceChallenge(WALLET, LOBBY, store);
    const sig = `valid_sig_for_${challenge.nonce}`;
    const first = await verifyProofAndIssueToken(WALLET, sig, 'MOCK_pubkey', LOBBY, store);
    assert.ok(first, 'first proof succeeds');
    const replay = await verifyProofAndIssueToken(WALLET, sig, 'MOCK_pubkey', LOBBY, store);
    assert.equal(replay, null, 'the nonce is single-use (replay rejected)');
  });

  await check('a wrong signature is rejected', async () => {
    const store = new InMemoryLobbyStore();
    await generateNonceChallenge(WALLET, LOBBY, store);
    const token = await verifyProofAndIssueToken(WALLET, 'valid_sig_for_WRONG', 'MOCK_pubkey', LOBBY, store);
    assert.equal(token, null);
  });

  // ── H. Lobby management authorization (Phase 1c) ──
  const mkLobby = (id: string, createdBy: string) =>
    ({ lobby_id: id, org_id: 'default', name: 'L', status: 'active', connected_agent_ids: [], message_seq: 0, created_at: '', updated_at: '', created_by: createdBy }) as unknown as Parameters<InMemoryLobbyStore['createLobby']>[0];
  const mkMember = (lobbyId: string, ref: string, role: string, status = 'active') =>
    ({ id: `m_${ref}`, lobby_id: lobbyId, identity_ref: ref, role, status }) as unknown as Parameters<InMemoryLobbyStore['addMember']>[0];

  await check('lobbyOwnerRef ignores the legacy unowned defaults', () => {
    assert.equal(lobbyOwnerRef({ created_by: 'system' }), null);
    assert.equal(lobbyOwnerRef({ created_by: '' }), null);
    assert.equal(lobbyOwnerRef({ created_by: 'did:ccd:testnet:o' }), 'did:ccd:testnet:o');
  });

  await check('the bound owner (created_by) may manage the lobby', async () => {
    const store = new InMemoryLobbyStore();
    await store.createLobby(mkLobby('L1', 'did:ccd:testnet:owner'));
    assert.equal(await isLobbyManager(store, 'L1', 'did:ccd:testnet:owner'), true);
    assert.equal(await isLobbyManager(store, 'L1', 'did:ccd:testnet:someone-else'), false);
  });

  await check('an owner/admin member may manage; contributor/observer may not', async () => {
    const store = new InMemoryLobbyStore();
    await store.createLobby(mkLobby('L2', 'system')); // unowned by created_by
    await store.addMember(mkMember('L2', 'did:ccd:testnet:admin', 'admin'));
    await store.addMember(mkMember('L2', 'did:ccd:testnet:contrib', 'contributor'));
    assert.equal(await isLobbyManager(store, 'L2', 'did:ccd:testnet:admin'), true);
    assert.equal(await isLobbyManager(store, 'L2', 'did:ccd:testnet:contrib'), false);
  });

  await check('a revoked owner/admin member may not manage', async () => {
    const store = new InMemoryLobbyStore();
    await store.createLobby(mkLobby('L3', 'system'));
    await store.addMember(mkMember('L3', 'did:ccd:testnet:ex', 'admin', 'revoked'));
    assert.equal(await isLobbyManager(store, 'L3', 'did:ccd:testnet:ex'), false);
  });

  await check('unowned (legacy) and unknown lobbies deny management', async () => {
    const store = new InMemoryLobbyStore();
    await store.createLobby(mkLobby('L4', 'system'));
    assert.equal(await isLobbyManager(store, 'L4', 'did:ccd:testnet:anyone'), false);
    assert.equal(await isLobbyManager(store, 'does-not-exist', 'did:ccd:testnet:anyone'), false);
    assert.equal(await isLobbyManager(store, 'L4', ''), false);
  });

  // ── I. Hosted agent runner (server-side execution via the API runtime) ──
  const sseFetch = (chunks: string[], status = 200): typeof fetch =>
    (async () => new Response(
      status === 200
        ? chunks.map((t) => `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })}`).join('\n') + '\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n'
        : 'err',
      { status },
    )) as unknown as typeof fetch;
  const mkRunner = (fetchFn: typeof fetch, systemPrompt?: string) =>
    new HostedAgentRunner(
      createApiRuntimeAdapter({ provider: { id: 'anthropic-compatible', model: 'claude-opus-4-8' }, apiKey: 'k', fetchFn }),
      { systemPrompt },
    );

  await check('hosted runner turns an inbound message into the model reply', async () => {
    const r = mkRunner(sseFetch(['Ready', ' to work']), 'You are a hosted boss.');
    await r.start();
    assert.equal(await r.respondTo('who is ready?'), 'Ready to work');
    await r.stop();
  });

  await check('hosted runner keeps continuity across turns', async () => {
    const r = mkRunner(sseFetch(['ok']));
    assert.equal(await r.respondTo('one'), 'ok');
    assert.equal(await r.respondTo('two'), 'ok');
    await r.stop();
  });

  await check('hosted runner surfaces a provider error as a ⚠ reply, not a throw', async () => {
    const r = mkRunner(sseFetch([], 500));
    const reply = await r.respondTo('go');
    assert.match(reply, /^⚠/);
    await r.stop();
  });

  await check('dev wallet-signature bridge: on accepts any non-empty sig; off rejects garbage; MOCK unaffected', () => {
    const on = { AGENT_OS_DEV_TRUST_WALLET_SIGNATURES: '1' } as NodeJS.ProcessEnv;
    const off = {} as NodeJS.ProcessEnv;
    assert.equal(verifySignature('nonce', 'anyhexsig', 'ccd-addr', on), true, 'dev bridge accepts a non-empty signature');
    assert.equal(verifySignature('nonce', '', 'ccd-addr', on), false, 'even the dev bridge rejects an empty signature');
    assert.equal(verifySignature('nonce', 'garbage', 'ccd-addr', off), false, 'off: an unverifiable signature is rejected');
    assert.equal(verifySignature('n', 'valid_sig_for_n', 'MOCK_x', off), true, 'MOCK path is independent of the flag');
  });

  // ── J. Production Concordium wallet verifier ──
  const ACCOUNT = '4DCywKkv7jegSt2oJoYuhwm7nJHJYN4zh4vzRdfcFKHSpFxq3H';
  // Build a real ed25519 account: keypair → accountInfo carrying the public key → a signer.
  function makeAccount(base58: string) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const seedHex = (privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer).subarray(-32).toString('hex');
    const pubHex = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32).toString('hex');
    const address = AccountAddress.fromBase58(base58);
    const accountInfo = {
      accountAddress: address, accountThreshold: 1,
      accountCredentials: { 0: { value: { contents: { credentialPublicKeys: { keys: { 0: { schemeId: 'Ed25519', verifyKey: pubHex } }, threshold: 1 } } } } },
    };
    return { address, signer: buildBasicAccountSigner(seedHex), accountInfo };
  }
  class MockSource implements AccountInfoSource {
    public calls = 0;
    constructor(private readonly infos: Map<string, unknown>) {}
    async getAccountInfo(account: string, _network: CcdNetwork) { this.calls++; return this.infos.get(account) ?? null; }
  }
  const ORIGIN = 'https://lobby.example';
  async function challengeAndSign(store: InMemoryLobbyStore, acct: ReturnType<typeof makeAccount>, over: Partial<{ origin: string; lobbyId: string; network: string }> = {}) {
    const ch = await createWalletChallenge(store, { account: ACCOUNT, lobbyId: over.lobbyId ?? 'L1', origin: over.origin ?? ORIGIN, network: over.network });
    const signature = await signMessage(acct.address, ch.challenge, acct.signer);
    return { ch, signature };
  }

  await check('dev bridge cannot be enabled in production (fail-closed startup)', () => {
    assert.doesNotThrow(() => assertDevBridgeNotInProduction({} as NodeJS.ProcessEnv), 'off → no throw');
    assert.doesNotThrow(() => assertDevBridgeNotInProduction({ AGENT_OS_DEV_TRUST_WALLET_SIGNATURES: '1', NODE_ENV: 'development' } as NodeJS.ProcessEnv), 'dev → allowed');
    assert.throws(() => assertDevBridgeNotInProduction({ AGENT_OS_DEV_TRUST_WALLET_SIGNATURES: '1', NODE_ENV: 'production' } as NodeJS.ProcessEnv), /refusing to start/);
    assert.throws(() => assertDevBridgeNotInProduction({ AGENT_OS_DEV_TRUST_WALLET_SIGNATURES: 'on', AGENT_OS_ENV: 'production' } as NodeJS.ProcessEnv));
  });

  await check('challenge creation rejects an invalid account address', async () => {
    const store = new InMemoryLobbyStore();
    await assert.rejects(createWalletChallenge(store, { account: 'not-a-ccd-address', lobbyId: 'L1', origin: ORIGIN }));
  });

  await check('valid wallet signature verifies against fresh on-chain keys and mints a token', async () => {
    const store = new InMemoryLobbyStore();
    const acct = makeAccount(ACCOUNT);
    const source = new MockSource(new Map([[ACCOUNT, acct.accountInfo]]));
    const { ch, signature } = await challengeAndSign(store, acct);
    const res = await verifyWalletChallenge(store, source, { challengeId: ch.challengeId, account: ACCOUNT, signature, origin: ORIGIN, sessionId: ch.sessionId });
    assert.ok(res, 'verification succeeds');
    assert.equal(res!.identityRef, `did:ccd:mainnet:${ACCOUNT}`);
    assert.ok(source.calls >= 1, 'fresh getAccountInfo was called at verify time');
  });

  await check('challenge is single-use — a replay of the same challenge fails', async () => {
    const store = new InMemoryLobbyStore();
    const acct = makeAccount(ACCOUNT);
    const source = new MockSource(new Map([[ACCOUNT, acct.accountInfo]]));
    const { ch, signature } = await challengeAndSign(store, acct);
    const first = await verifyWalletChallenge(store, source, { challengeId: ch.challengeId, account: ACCOUNT, signature, origin: ORIGIN, sessionId: ch.sessionId });
    const replay = await verifyWalletChallenge(store, source, { challengeId: ch.challengeId, account: ACCOUNT, signature, origin: ORIGIN, sessionId: ch.sessionId });
    assert.ok(first);
    assert.equal(replay, null, 'the consumed challenge cannot be reused');
  });

  await check('expired challenge is rejected', async () => {
    const store = new InMemoryLobbyStore();
    const acct = makeAccount(ACCOUNT);
    const source = new MockSource(new Map([[ACCOUNT, acct.accountInfo]]));
    const { ch, signature } = await challengeAndSign(store, acct);
    // Force-expire by rewriting the stored record's expiry in the past.
    const stored = await store.consumeWalletChallenge(ch.challengeId);
    await store.saveWalletChallenge({ ...stored!, expires_at: Date.now() - 1 });
    const res = await verifyWalletChallenge(store, source, { challengeId: ch.challengeId, account: ACCOUNT, signature, origin: ORIGIN, sessionId: ch.sessionId });
    assert.equal(res, null);
  });

  await check('binding: origin / session / account mismatch all fail', async () => {
    const store = new InMemoryLobbyStore();
    const acct = makeAccount(ACCOUNT);
    const source = new MockSource(new Map([[ACCOUNT, acct.accountInfo]]));
    for (const bad of [
      { origin: 'https://evil.example', sessionId: undefined as string | undefined, account: undefined as string | undefined },
      { origin: undefined, sessionId: 'someone-elses-session', account: undefined },
      { origin: undefined, sessionId: undefined, account: 'different-account' },
    ]) {
      const { ch, signature } = await challengeAndSign(store, acct);
      const res = await verifyWalletChallenge(store, source, {
        challengeId: ch.challengeId, account: bad.account ?? ACCOUNT, signature,
        origin: bad.origin ?? ORIGIN, sessionId: bad.sessionId ?? ch.sessionId,
      });
      assert.equal(res, null);
    }
  });

  await check('a wrong signature is rejected; client-supplied keys are never trusted', async () => {
    const store = new InMemoryLobbyStore();
    const acct = makeAccount(ACCOUNT);
    const attacker = makeAccount(ACCOUNT); // different keypair, same address
    // On-chain source returns the REAL account keys; the attacker signs with their own key.
    const source = new MockSource(new Map([[ACCOUNT, acct.accountInfo]]));
    const ch = await createWalletChallenge(store, { account: ACCOUNT, lobbyId: 'L1', origin: ORIGIN });
    const forgedSig = await signMessage(attacker.address, ch.challenge, attacker.signer);
    const res = await verifyWalletChallenge(store, source, { challengeId: ch.challengeId, account: ACCOUNT, signature: forgedSig, origin: ORIGIN, sessionId: ch.sessionId });
    assert.equal(res, null, 'a signature not matching the on-chain keys fails — client keys are irrelevant');
  });

  await check('an account that cannot be fetched fresh fails closed', async () => {
    const acct = makeAccount(ACCOUNT);
    const emptySource = new MockSource(new Map()); // getAccountInfo → null
    const sig = await signMessage(acct.address, 'msg', acct.signer);
    assert.equal(await verifyAccountSignatureFresh('msg', ACCOUNT, sig, 'mainnet', emptySource), false);
    assert.equal(await verifyAccountSignatureFresh('msg', 'bad-address', sig, 'mainnet', emptySource), false);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.error(`FAILED: ${failures.join(', ')}`); process.exit(1); }
  console.log('verify-hosted: all checks passed ✓');
}

main().catch((err) => { console.error(err); process.exit(1); });
