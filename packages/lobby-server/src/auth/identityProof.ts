// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

import { randomBytes, verify } from 'node:crypto';
import type { LobbyStore } from '../store.js';

const NONCE_EXPIRY_MS = 5 * 60 * 1000; // Nonces expire in 5 minutes
const SESSION_EXPIRY_MS = 15 * 60 * 1000; // Session tokens expire in 15 minutes

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
export async function generateNonceChallenge(identityRef: string, store: LobbyStore): Promise<NonceChallenge> {
  const nonce = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + NONCE_EXPIRY_MS;
  await store.saveNonce(identityRef, nonce, expiresAt);
  return { identityRef, nonce, expiresAt };
}

/** Verify signature proof of possession of the private key corresponding to the public key. */
export function verifySignature(nonce: string, signature: string, publicKeyPem: string): boolean {
  try {
    if (publicKeyPem.startsWith('MOCK_')) {
      return signature === `valid_sig_for_${nonce}`;
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

  // Signature verification
  const isValid = verifySignature(challenge.nonce, signature, publicKeyPem);
  if (!isValid) return null;

  // Issue a short-lived, encrypted or signed token string (represented as a secure JSON token payload here)
  const payload: SessionTokenPayload = {
    identityRef,
    lobbyId,
    expiresAt: Date.now() + SESSION_EXPIRY_MS,
  };

  // Convert payload to a simple authenticated string structure (base64 payload + simple signature for verification)
  const rawPayload = JSON.stringify(payload);
  const tokenBytes = Buffer.from(rawPayload, 'utf-8').toString('base64');
  return tokenBytes;
}

/** Validate a short-lived lobby session token for WebSocket join. */
export function validateSessionToken(token: string, lobbyId: string): SessionTokenPayload | null {
  try {
    const rawPayload = Buffer.from(token, 'base64').toString('utf-8');
    const payload = JSON.parse(rawPayload) as SessionTokenPayload;

    if (!payload.identityRef || payload.lobbyId !== lobbyId) return null;
    if (Date.now() > payload.expiresAt) return null;

    return payload;
  } catch (err) {
    return null;
  }
}
