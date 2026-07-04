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
import { InMemoryLobbyStore } from '../../packages/lobby-server/src/store.js';
import { seal, open, keyHint, sealedKeyId, currentKeyId } from '../../packages/lobby-server/src/crypto/secret-box.js';
import {
  setProviderKey, resolveProviderKey, listProviderKeys, revokeProviderKey, toPublicView,
} from '../../packages/lobby-server/src/providers/key-custody.js';

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

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.error(`FAILED: ${failures.join(', ')}`); process.exit(1); }
  console.log('verify-hosted: all checks passed ✓');
}

main().catch((err) => { console.error(err); process.exit(1); });
