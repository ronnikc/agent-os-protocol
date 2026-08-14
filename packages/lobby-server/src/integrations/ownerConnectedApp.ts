// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

import { randomBytes } from 'node:crypto';
import type { LobbyStore } from '../store.js';
import type { LobbyIntegration, IntegrationSecret } from '../models.js';
import { saveIntegrationSecret, getDecryptedSecret } from './githubApp.js';

/**
 * Owner-connected integrations (Discord, Telegram, Supabase, …) follow one shape: the LobbyOwner
 * brings their OWN credential (a bot token, a project service key), the lobby seals it per-lobby and
 * never shares it, and orchestration runs against the owner's own account. This is the neutral
 * install/status/revoke core so each provider's HTTP handler stays a thin wrapper — mirroring the
 * Slack foundation, generalized so Discord/Telegram/Supabase don't each reinvent secret handling.
 */

export type OwnerConnectedProvider = 'discord' | 'telegram' | 'supabase' | 'slack' | 'dreambase';

export interface ConnectOwnerIntegrationParams {
  lobbyId: string;
  /** Identity of the owner performing the connect (for provenance + revocation audit). */
  identityRef: string;
  provider: OwnerConnectedProvider;
  /** The sealed credential — a bot token (Discord/Telegram) or a service key (Supabase). */
  secret: string;
  /** How the sealed value is classified in the vault. */
  secretType?: IntegrationSecret['secret_type'];
  /** Provider-side id: a Discord channel id, a Telegram chat id, or a Supabase project ref. */
  externalId?: string;
  /** Friendly name shown in the UI (server/workspace/project name). */
  externalName?: string;
  /** Non-secret config the UI needs back (e.g. Supabase project URL). Never a credential. */
  scopes?: string[];
}

/** Connect (or reconnect) an owner-provided integration, sealing its credential per-lobby. */
export async function connectOwnerIntegration(
  params: ConnectOwnerIntegrationParams,
  store: LobbyStore,
): Promise<LobbyIntegration> {
  // Revoke any prior integration for this provider so a reconnect never leaves a stale sealed token.
  const existing = await store.getIntegration(params.lobbyId, params.provider);
  if (existing) await store.updateIntegration(params.lobbyId, existing.id, { status: 'revoked' });

  const id = randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const integration: LobbyIntegration = {
    id,
    lobby_id: params.lobbyId,
    provider: params.provider,
    status: 'active',
    external_account_id: params.externalId,
    external_account_name: params.externalName,
    scopes: params.scopes ?? [],
    installed_by_identity_ref: params.identityRef,
    created_at: now,
    updated_at: now,
  };
  await store.addIntegration(integration);
  await saveIntegrationSecret(id, params.secretType ?? 'bot_token', params.secret, store);
  return integration;
}

/** Owner-facing status for a provider — NEVER returns the sealed credential, only a masked hint. */
export async function ownerIntegrationStatus(
  lobbyId: string,
  provider: OwnerConnectedProvider,
  store: LobbyStore,
  secretType: IntegrationSecret['secret_type'] = 'bot_token',
): Promise<{ connected: boolean; account?: string; external_id?: string; scopes?: string[]; secret_hint?: string }> {
  const integ = await store.getIntegration(lobbyId, provider);
  if (!integ || integ.status !== 'active') return { connected: false };
  let secretHint: string | undefined;
  try {
    const secret = await getDecryptedSecret(lobbyId, provider, secretType, store);
    if (secret) secretHint = maskSecret(secret);
  } catch { /* a missing/undecryptable secret just yields no hint */ }
  return {
    connected: true,
    account: integ.external_account_name,
    external_id: integ.external_account_id,
    scopes: integ.scopes,
    secret_hint: secretHint,
  };
}

/** Revoke a provider integration (leaves the record for audit; marks it revoked). */
export async function revokeOwnerIntegration(
  lobbyId: string,
  provider: OwnerConnectedProvider,
  store: LobbyStore,
): Promise<boolean> {
  const integ = await store.getIntegration(lobbyId, provider);
  if (!integ || integ.status !== 'active') return false;
  await store.updateIntegration(lobbyId, integ.id, { status: 'revoked' });
  return true;
}

/** Mask a secret to a non-reversible hint (`••••abcd`) so the UI can confirm one is set. */
export function maskSecret(secret: string): string {
  const tail = secret.slice(-4);
  return `••••${tail}`;
}
