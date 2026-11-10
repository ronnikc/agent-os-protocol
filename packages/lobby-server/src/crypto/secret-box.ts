// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * secret-box — authenticated symmetric encryption for at-rest server-side secrets
 * (integration tokens, hosted provider API keys). AES-256-GCM with a random 96-bit IV and an
 * auth tag, sealed into a single self-describing string `keyId.ciphertext.iv.tag` (all hex).
 *
 * The master key is derived (SHA-256) from an env var so ops can rotate it; the sealed value
 * carries the `keyId` it was written with so a decrypt can detect a rotated key. The plaintext
 * secret is never logged and never leaves the process — callers must keep the return value
 * of `open()` in-memory only.
 *
 * This generalises the AES-GCM helper that lived in integrations/githubApp.ts so provider-key
 * custody and integration secrets share one implementation and one key policy.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const SEP = '.';

/** Master key env var, preferred first. INTEGRATION_SECRET_KEY kept for continuity with the
 *  existing integration secrets so a single deployment key covers both. */
const KEY_ENV_VARS = ['AGENT_OS_SECRET_ENCRYPTION_KEY', 'INTEGRATION_SECRET_KEY'];
const KEY_ID_ENV = 'AGENT_OS_SECRET_KEY_ID';

function masterKeyMaterial(env: NodeJS.ProcessEnv): string {
  for (const name of KEY_ENV_VARS) {
    const v = env[name];
    if (v) return v;
  }
  // Deterministic dev fallback — refused for real use by requireProductionKey().
  return 'default-secret-key-do-not-use-in-production';
}

function deriveKey(env: NodeJS.ProcessEnv): Buffer {
  return createHash('sha256').update(masterKeyMaterial(env)).digest();
}

/** Current key id (version label) written into new seals. */
export function currentKeyId(env: NodeJS.ProcessEnv = process.env): string {
  return env[KEY_ID_ENV] || 'v1';
}

/** True when a real (non-fallback) master key is configured. Guards production paths. */
export function hasConfiguredKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return KEY_ENV_VARS.some((n) => !!env[n]);
}

/** Encrypt `plaintext` → `keyId.ciphertext.iv.tag`. */
export function seal(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, deriveKey(env), iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return [currentKeyId(env), ciphertext, iv.toString('hex'), tag].join(SEP);
}

/** Decrypt a value produced by `seal()`. Throws on tamper (GCM auth failure) or malformed input. */
export function open(sealed: string, env: NodeJS.ProcessEnv = process.env): string {
  const parts = sealed.split(SEP);
  if (parts.length !== 4) throw new Error('secret-box: malformed sealed value');
  const [, ciphertext, ivHex, tagHex] = parts;
  const decipher = createDecipheriv(ALGORITHM, deriveKey(env), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

/** The keyId a sealed value was written with (for rotation detection). */
export function sealedKeyId(sealed: string): string {
  return sealed.split(SEP)[0] ?? '';
}

/** Non-secret display hint for a key — last 4 chars, the rest masked. Never store the raw key for display. */
export function keyHint(plaintext: string): string {
  if (!plaintext) return '';
  const tail = plaintext.slice(-4);
  return `••••${tail}`;
}
