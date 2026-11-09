// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

import { randomBytes, verify, createHmac, timingSafeEqual, createHash } from 'node:crypto';
import type { LobbyStore } from '../store.js';

const NONCE_EXPIRY_MS = 5 * 60 * 1000; // Nonces expire in 5 minutes
const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // Session tokens expire in 7 days
const ephemeralSigningMaterial = randomBytes(32).toString('hex');
export const TEST_ADMIN_IDENTITY = 'test-admin';
export const TEST_ADMIN_LOBBY_ID = 'd47340a1-af18-4e77-aeb2-40dc86fb9810';
const TEST_ADMIN_SESSION_TTL_MS = 60 * 60 * 1000;

export function liveTestAdminConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = env.AGENT_OS_LIVE_TEST_ADMIN?.match(/^(all|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}):([0-9a-f]{64}):(\d{13})$/i);
  if (!config || !isProduction(env)) return;
  const [, lobbyId, digest, deadline] = config;
  const expiresAt = Number(deadline);
  const now = Date.now();
  if (expiresAt <= now || expiresAt - now > 24 * TEST_ADMIN_SESSION_TTL_MS) return;
  return { lobbyId, digest, expiresAt };
}

export function liveTestAdminAllowsLobby(lobbyId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const scope = liveTestAdminConfig(env)?.lobbyId;
  return scope === 'all' || scope === lobbyId;
}

export function testAdminKeyDigest(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const digest = env.AGENT_OS_TEST_ADMIN_KEY_SHA256?.trim();
  if (!isProduction(env) && digest && /^[a-f0-9]{64}$/i.test(digest)) return digest;
}

// Session tokens are HMAC-signed with a server secret so they cannot be forged. Before this,
// the token was plain base64 of the payload — anyone could mint a session for ANY wallet, which
// defeats the entire "lock data to the wallet" model. The key is derived from the same server
// secret used for at-rest encryption (see crypto/secret-box.ts); Hosted Mode MUST set it.
function sessionSigningKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const material =
    env.AGENT_OS_SECRET_ENCRYPTION_KEY ||
    env.INTEGRATION_SECRET_KEY ||
    ephemeralSigningMaterial;
  return createHash('sha256').update(`session:${material}`).digest();
}

function signPayload(payloadB64: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac('sha256', sessionSigningKey(env)).update(payloadB64).digest('base64url');
}

export interface NonceChallenge {
  identityRef: string;
  nonce: string;
  expiresAt: number;
}

export interface SessionTokenPayload {
  identityRef: string;
  lobbyId: string;
  expiresAt: number;
}

/** Generate a secure random nonce for an identity ref and save it to the store. */
export async function generateNonceChallenge(identityRef: string, lobbyId: string, store: LobbyStore): Promise<NonceChallenge> {
  const nonce = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + NONCE_EXPIRY_MS;
  await store.saveNonce(identityRef, lobbyId, nonce, expiresAt);
  return { identityRef, nonce, expiresAt };
}

let devTrustWarned = false;

/** True when the dev wallet-signature bridge is enabled (demo/testnet only). */
export function devTrustWalletSignatures(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|on|true)$/i.test(env.AGENT_OS_DEV_TRUST_WALLET_SIGNATURES ?? '');
}

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return [env.NODE_ENV, env.AGENT_OS_ENV].some((value) => /^prod(uction)?$/i.test(value ?? ''));
}

/**
 * Verify a wallet signature over the login nonce. Supports:
 *  - MOCK_ keys (tests), and standard ed25519/EC PEM keys (`crypto.verify`).
 *  - A DEV BRIDGE (`AGENT_OS_DEV_TRUST_WALLET_SIGNATURES=1`) that accepts any non-empty signature
 *    so the hosted panel can be demoed on testnet before the production Concordium ed25519 verifier
 *    lands. It is OFF by default, logs a loud one-time warning, and MUST NOT be set in production —
 *    it disables proof-of-possession entirely.
 */
export function verifySignature(nonce: string, signature: string, publicKeyPem: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    if (publicKeyPem.startsWith('MOCK_')) {
      return signature === `valid_sig_for_${nonce}`;
    }
    if (devTrustWalletSignatures(env)) {
      if (!devTrustWarned) {
        devTrustWarned = true;
        console.warn('[auth] ⚠ AGENT_OS_DEV_TRUST_WALLET_SIGNATURES is ON — wallet signatures are NOT verified. Demo/testnet only; NEVER enable in production.');
      }
      return signature.length > 0;
    }
    const data = Buffer.from(nonce, 'utf-8');
    const signatureBuffer = Buffer.from(signature, 'hex');
    return verify(undefined, data, publicKeyPem, signatureBuffer);
  } catch (err) {
    return false;
  }
}

/** Validate signature proof against store nonces, checking for replay attacks. */
export async function verifyProofAndIssueToken(
  identityRef: string,
  signature: string,
  publicKeyPem: string,
  lobbyId: string,
  store: LobbyStore
): Promise<string | null> {
  if (identityRef === TEST_ADMIN_IDENTITY || lobbyId === TEST_ADMIN_LOBBY_ID) return null;
  const challenge = await store.getNonce(identityRef);
  if (!challenge) return null;

  // Replay protection: delete nonce immediately on verification attempt
  await store.deleteNonce(identityRef);

  // Expired nonce validation
  if (Date.now() > challenge.expiresAt) return null;

  // Lobby binding validation
  if (challenge.lobbyId !== lobbyId) return null;

  // Signature verification
  const isValid = verifySignature(challenge.nonce, signature, publicKeyPem);
  if (!isValid) return null;

  return issueSessionToken(identityRef, lobbyId);
}

/**
 * Mint an unforgeable, short-lived session token binding a proven wallet (`identityRef`) to a
 * lobby. HMAC over the payload with the server secret prevents forgery. Call ONLY after ownership
 * is proven (nonce/challenge signature verified) — this function does no verification itself.
 */
export function issueSessionToken(identityRef: string, lobbyId: string): string {
  const ttlMs = identityRef === TEST_ADMIN_IDENTITY ? TEST_ADMIN_SESSION_TTL_MS : SESSION_EXPIRY_MS;
  const liveAdmin = identityRef === TEST_ADMIN_IDENTITY ? liveTestAdminConfig() : undefined;
  const expiresAt = Math.min(Date.now() + ttlMs, liveAdmin?.expiresAt ?? Infinity);
  const payload: SessionTokenPayload = { identityRef, lobbyId, expiresAt };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  return `${payloadB64}.${signPayload(payloadB64)}`;
}

/**
 * Fail-closed guard for the dev signature bridge. The bridge disables proof-of-possession, so it
 * must never run in production: throw if it is enabled while the runtime looks like production.
 * Call at server startup. Returns silently when the bridge is off or the env is non-production.
 */
export function assertDevBridgeNotInProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (!devTrustWalletSignatures(env)) return;
  if (isProduction(env)) {
    throw new Error(
      'AGENT_OS_DEV_TRUST_WALLET_SIGNATURES is enabled in a production environment — refusing to start. ' +
      'This bridge disables wallet-signature verification and is for local/testnet only. Unset it in production.',
    );
  }
}

/** Validate a short-lived, HMAC-signed lobby session token. Returns the payload, or null if the
 *  token is forged, tampered, expired, or bound to a different lobby. */
export function validateSessionToken(token: string, lobbyId: string, env: NodeJS.ProcessEnv = process.env): SessionTokenPayload | null {
  try {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const payloadB64 = token.slice(0, dot);
    const mac = token.slice(dot + 1);

    // Constant-time HMAC check before trusting any payload bytes.
    const expected = signPayload(payloadB64, env);
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as SessionTokenPayload;
    if (!payload.identityRef || payload.lobbyId !== lobbyId) return null;
    if (payload.identityRef === TEST_ADMIN_IDENTITY) {
      if (!liveTestAdminAllowsLobby(lobbyId, env) &&
          !(lobbyId === TEST_ADMIN_LOBBY_ID && testAdminKeyDigest(env))) return null;
    }
    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}
