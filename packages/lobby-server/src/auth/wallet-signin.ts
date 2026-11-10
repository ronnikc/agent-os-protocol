// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * Production wallet sign-in flow: issue a bound, single-use challenge, then verify the wallet's
 * signature over it against the account's FRESH on-chain credentials and mint a lobby session token.
 *
 *   POST /auth/challenge  → { challenge_id, challenge }   (client signs `challenge` with the wallet)
 *   POST /auth/verify-wallet { challenge_id, account, signature, session_id } → { token }
 *
 * The challenge binds account + origin + network + session + lobby, so a signature captured in one
 * context cannot be replayed in another. It is consumed on the first verify attempt (success or not).
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { LobbyStore } from '../store.js';
import type { WalletChallenge } from '../models.js';
import { issueSessionToken } from './identityProof.js';
import {
  type AccountInfoSource, type CcdNetwork, isValidAccountAddress, normalizeNetwork, verifyAccountSignatureFresh,
} from './concordium-verifier.js';

const CHALLENGE_TTL_MS = 90_000; // 90s — short-lived per Concordium guidance.

/** Build the exact string the wallet signs. Order + whitespace are part of the contract. */
export function buildChallengeString(p: {
  account: string; origin: string; network: CcdNetwork; sessionId: string; lobbyId: string; nonce: string; issuedAt: string;
}): string {
  return [
    'Agent OS wallet sign-in',
    `Account: ${p.account}`,
    `Origin: ${p.origin}`,
    `Network: ${p.network}`,
    `Lobby: ${p.lobbyId}`,
    `Session: ${p.sessionId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt}`,
  ].join('\n');
}

export interface CreateChallengeInput {
  account: string;
  origin: string;
  lobbyId: string;
  sessionId?: string;
  network?: unknown;
}

/** Create + persist a bound challenge. Throws on an invalid account address. */
export async function createWalletChallenge(store: LobbyStore, input: CreateChallengeInput): Promise<{ challengeId: string; challenge: string; expiresAt: number; sessionId: string }> {
  if (!isValidAccountAddress(input.account)) throw new Error('invalid account address');
  const network = normalizeNetwork(input.network);
  const sessionId = input.sessionId && String(input.sessionId).trim() ? String(input.sessionId).trim() : randomUUID();
  const nonce = randomBytes(32).toString('hex');
  const issuedAt = new Date().toISOString();
  const challenge = buildChallengeString({ account: input.account, origin: input.origin, network, sessionId, lobbyId: input.lobbyId, nonce, issuedAt });
  const record: WalletChallenge = {
    id: `wc_${randomUUID()}`,
    account: input.account,
    origin: input.origin,
    network,
    session_id: sessionId,
    lobby_id: input.lobbyId,
    challenge,
    expires_at: Date.now() + CHALLENGE_TTL_MS,
  };
  await store.saveWalletChallenge(record);
  return { challengeId: record.id, challenge, expiresAt: record.expires_at, sessionId };
}

export interface VerifyChallengeInput {
  challengeId: string;
  account: string;
  signature: unknown;
  origin: string;
  sessionId: string;
}

/**
 * Consume the challenge (single-use), re-check every binding, verify the signature against fresh
 * on-chain credentials, and mint a session token. Returns null on any failure (generic — never
 * reveals which check failed or whether the account exists).
 */
export async function verifyWalletChallenge(
  store: LobbyStore,
  source: AccountInfoSource,
  input: VerifyChallengeInput,
): Promise<{ token: string; identityRef: string; network: CcdNetwork; lobbyId: string } | null> {
  const pending = await store.consumeWalletChallenge(input.challengeId); // single-use, always consumed
  if (!pending) return null;
  if (Date.now() > pending.expires_at) return null;
  if (pending.account !== input.account) return null;
  if (pending.origin !== input.origin) return null;
  if (pending.session_id !== input.sessionId) return null;

  const ok = await verifyAccountSignatureFresh(pending.challenge, input.account, input.signature, pending.network, source);
  if (!ok) return null;

  const identityRef = `did:ccd:${pending.network}:${input.account}`;
  return { token: issueSessionToken(identityRef, pending.lobby_id), identityRef, network: pending.network, lobbyId: pending.lobby_id };
}
