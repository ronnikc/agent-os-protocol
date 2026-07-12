// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import type { LobbyStore } from '../store.js';
import type { LobbyIntegration, IntegrationSecret } from '../models.js';

const ALGORITHM = 'aes-256-gcm';

/** Derive a 256-bit encryption key from process environment variables. */
function getEncryptionKey(): Buffer {
  const masterKey = process.env.INTEGRATION_SECRET_KEY || 'default-secret-key-do-not-use-in-production';
  return createHash('sha256').update(masterKey).digest();
}

/** Encrypt a token value using AES-256-GCM. Returns { ciphertext, iv, tag }. */
export function encryptSecret(plaintext: string): { ciphertext: string; iv: string; tag: string; keyId: string } {
  const iv = randomBytes(12);
  const key = getEncryptionKey();
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  
  const tag = cipher.getAuthTag().toString('hex');
  const keyId = process.env.INTEGRATION_KEY_ID || 'v1';

  return {
    ciphertext,
    iv: iv.toString('hex'),
    tag,
    keyId
  };
}

/** Decrypt an AES-256-GCM ciphertext using the keyId and stored parameters. */
export function decryptSecret(ciphertext: string, ivHex: string, tagHex: string): string {
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const key = getEncryptionKey();
  
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

/** Retrieve and decrypt an integration secret. Logs are redacted. */
export async function getDecryptedSecret(
  lobbyId: string,
  provider: 'slack' | 'github' | 'google_drive' | 'discord' | 'telegram' | 'supabase',
  secretType: string,
  store: LobbyStore
): Promise<string | null> {
  const integration = await store.getIntegration(lobbyId, provider);
  if (!integration) return null;

  const secret = await store.getSecret(integration.id, secretType);
  if (!secret) return null;

  try {
    const parts = secret.encrypted_value.split(':');
    if (parts.length !== 3) throw new Error('Malformed secret storage format');
    const [ciphertext, iv, tag] = parts;
    const decrypted = decryptSecret(ciphertext, iv, tag);

    // Verify key ID compatibility
    if (secret.encryption_key_id !== (process.env.INTEGRATION_KEY_ID || 'v1')) {
      // Key rotation warning (safely logged)
      console.warn(`[Integration] Secret decrypted using rotated key ID: ${secret.encryption_key_id}`);
    }

    return decrypted;
  } catch (err) {
    console.error('[Integration] Error decrypting integration secret (redacted)');
    return null;
  }
}

/** Save an integration secret securely. */
export async function saveIntegrationSecret(
  integrationId: string,
  secretType: 'access_token' | 'refresh_token' | 'bot_token' | 'signing_secret' | 'installation_token',
  value: string,
  store: LobbyStore,
  expiresInSeconds?: number
): Promise<IntegrationSecret> {
  const { ciphertext, iv, tag, keyId } = encryptSecret(value);
  const encryptedValue = `${ciphertext}:${iv}:${tag}`;

  const secret: IntegrationSecret = {
    id: randomBytes(16).toString('hex'),
    integration_id: integrationId,
    secret_type: secretType,
    encrypted_value: encryptedValue,
    encryption_key_id: keyId,
    expires_at: expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : undefined,
    rotated_at: new Date().toISOString()
  };

  return await store.addSecret(secret);
}

/** Redact sensitive credentials from error logs or strings. */
export function redactLogs(message: string): string {
  // Redacts slack tokens (xoxb- / xapp-), github tokens (ghs_ / ghp_), bearer auth credentials, and GCM ciphertexts
  return message
    .replace(/xoxb-[a-zA-Z0-9-]+/g, 'xoxb-REDACTED')
    .replace(/xapp-[a-zA-Z0-9-]+/g, 'xapp-REDACTED')
    .replace(/ghs_[a-zA-Z0-9]+/g, 'ghs_REDACTED')
    .replace(/ghp_[a-zA-Z0-9]+/g, 'ghp_REDACTED')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer REDACTED')
    .replace(/[a-f0-9]{16,}:[a-f0-9]{24}:[a-f0-9]{32}/gi, 'ENC-REDACTED');
}
