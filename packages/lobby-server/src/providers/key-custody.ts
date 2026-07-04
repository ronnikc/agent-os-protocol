// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Provider-key custody — Hosted-Mode storage of model-provider API keys so a no-local-setup user
 * can run agents from the online lobby. Keys are sealed with secret-box (AES-256-GCM) and stored
 * via the LobbyStore; the plaintext is only ever reconstituted in-process by `resolveProviderKey`
 * for a server-side model call (Phase 2 execution). The API/UI only ever see the public view
 * (masked hint, provider, scope) — never the key.
 *
 * Scope: a config with `agent_ref: null` is the lobby default that all its agents share; a config
 * with `agent_ref` set overrides it for that one agent. This matches "configure APIs either for the
 * private lobby or for each agent individually."
 *
 * No spend metering — usage/limits are governed entirely by the user's own provider account.
 */

import { randomUUID } from 'node:crypto';
import type { LobbyStore } from '../store.js';
import type { ProviderKeyConfig } from '../models.js';
import { seal, open, currentKeyId, keyHint, sealedKeyId } from '../crypto/secret-box.js';

export interface SetProviderKeyInput {
  lobbyId: string;
  /** null/undefined = lobby default; a value = per-agent override. */
  agentRef?: string | null;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Wallet identity_ref of the owner performing the write (authz is enforced by the caller). */
  identityRef: string;
  env?: NodeJS.ProcessEnv;
}

/** Public, secret-free view of a stored config — safe to return over the API / render in the UI. */
export interface ProviderKeyView {
  id: string;
  lobby_id: string;
  agent_ref: string | null;
  provider: string;
  key_hint: string;
  base_url?: string;
  model?: string;
  scope: 'lobby' | 'agent';
  created_by_identity_ref: string;
  created_at: string;
  updated_at: string;
}

export function toPublicView(c: ProviderKeyConfig): ProviderKeyView {
  return {
    id: c.id,
    lobby_id: c.lobby_id,
    agent_ref: c.agent_ref,
    provider: c.provider,
    key_hint: c.key_hint,
    base_url: c.base_url,
    model: c.model,
    scope: c.agent_ref ? 'agent' : 'lobby',
    created_by_identity_ref: c.created_by_identity_ref,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

const PROVIDER_RE = /^[a-z0-9][a-z0-9-]{0,39}$/i;

/** Seal + store a provider key. Returns the public view (never the key). Upserts by scope. */
export async function setProviderKey(store: LobbyStore, input: SetProviderKeyInput): Promise<ProviderKeyView> {
  const provider = (input.provider || '').trim();
  if (!PROVIDER_RE.test(provider)) throw new Error('invalid provider id');
  const apiKey = (input.apiKey || '').trim();
  if (!apiKey) throw new Error('apiKey is required');
  if (apiKey.length > 8192) throw new Error('apiKey too large');
  if (input.baseUrl && !/^https?:\/\//i.test(input.baseUrl)) throw new Error('base_url must be http(s)');

  const now = new Date().toISOString();
  const agentRef = input.agentRef ?? null;
  const config: ProviderKeyConfig = {
    id: `pk_${randomUUID()}`,
    lobby_id: input.lobbyId,
    agent_ref: agentRef,
    provider,
    encrypted_key: seal(apiKey, input.env),
    encryption_key_id: currentKeyId(input.env),
    key_hint: keyHint(apiKey),
    base_url: input.baseUrl,
    model: input.model,
    created_by_identity_ref: input.identityRef,
    created_at: now,
    updated_at: now,
  };
  const saved = await store.putProviderKey(config);
  return toPublicView(saved);
}

export interface ResolvedProviderKey {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  scope: 'lobby' | 'agent';
  /** True when the sealed value used a key id other than the current one — rotate on next write. */
  staleKeyId: boolean;
}

/**
 * Resolve the effective decrypted key for a server-side model call: a per-agent override wins over
 * the lobby default. Returns null when no key is configured for the scope. The returned `apiKey`
 * must stay in-process — never log, serialize, or send it to a client.
 */
export async function resolveProviderKey(
  store: LobbyStore,
  lobbyId: string,
  provider: string,
  agentRef?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedProviderKey | null> {
  const config = await store.getProviderKey(lobbyId, provider, agentRef ?? null);
  if (!config) return null;
  return {
    provider: config.provider,
    apiKey: open(config.encrypted_key, env),
    baseUrl: config.base_url,
    model: config.model,
    scope: config.agent_ref ? 'agent' : 'lobby',
    staleKeyId: sealedKeyId(config.encrypted_key) !== currentKeyId(env),
  };
}

/** List configured keys for a lobby as public views (no plaintext, no ciphertext). */
export async function listProviderKeys(store: LobbyStore, lobbyId: string): Promise<ProviderKeyView[]> {
  return (await store.listProviderKeys(lobbyId)).map(toPublicView);
}

/** Revoke a stored key by id. Returns the public view of the revoked config, or null if absent. */
export async function revokeProviderKey(store: LobbyStore, id: string): Promise<ProviderKeyView | null> {
  const revoked = await store.revokeProviderKey(id);
  return revoked ? toPublicView(revoked) : null;
}
