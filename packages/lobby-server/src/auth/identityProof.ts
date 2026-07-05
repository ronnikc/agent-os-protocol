// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

import { randomBytes, verify, createHmac, timingSafeEqual, createHash } from 'node:crypto';
import type { LobbyStore } from '../store.js';

const NONCE_EXPIRY_MS = 5 * 60 * 1000; // Nonces expire in 5 minutes
const SESSION_EXPIRY_MS = 15 * 60 * 1000; // Session tokens expire in 15 minutes

// Session tokens are HMAC-signed with a server secret so they cannot be forged. Before this,
// the token was plain base64 of the payload — anyone could mint a session for ANY wallet, which
// defeats the entire "lock data to the wallet" model. The key is derived from the same server
// secret used for at-rest encryption (see crypto/secret-box.ts); Hosted Mode MUST set it.
function sessionSigningKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const material =
    env.AGENT_OS_SECRET_ENCRYPTION_KEY ||
    env.INTEGRATION_SECRET_KEY ||
    'default-secret-key-do-not-use-in-production';
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

  // Issue a short-lived, encrypted or signed token string (represented as a secure JSON token payload here)
  const payload: SessionTokenPayload = {
    identityRef,
    lobbyId,
    expiresAt: Date.now() + SESSION_EXPIRY_MS,
  };

  // Authenticated token: `<base64url(payload)>.<hmac>`. The HMAC over the payload with the server
  // secret makes the token unforgeable — a client cannot mint a session for a wallet it doesn't own.
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  return `${payloadB64}.${signPayload(payloadB64)}`;
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
    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}
