// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * GitHub App authentication — mints the App JWT and exchanges it for short-lived **installation**
 * access tokens. The App lets a user connect their OWN repos (public or private) by installing it on
 * selected repositories; the lobby then acts through the installation, never storing a user password
 * and holding only a revocable, ~1h installation token. No repo is hosted here — the token grants
 * scoped API access to the user's repo.
 *
 * Config (operator registers one GitHub App and sets these):
 *   GITHUB_APP_ID            — the App's numeric id
 *   GITHUB_APP_PRIVATE_KEY   — the App's PEM private key (\n-escaped or literal newlines)
 *   GITHUB_APP_SLUG          — the App's slug, for building the install URL
 *   GITHUB_APP_CLIENT_ID     — (optional) OAuth client id, if also using user-auth
 */

import { createSign } from 'node:crypto';

import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const GITHUB_API = 'https://api.github.com';

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  slug?: string;
}

const CONFIG_FILE = join(process.cwd(), '.github-app-config.json');

let dynamicConfig: GitHubAppConfig | null = null;
try {
  if (existsSync(CONFIG_FILE)) {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.appId && parsed.privateKey) {
      dynamicConfig = {
        appId: parsed.appId,
        privateKey: parsed.privateKey,
        slug: parsed.slug || undefined
      };
      console.log('Loaded dynamic GitHub App configuration from .github-app-config.json');
    }
  }
} catch (e) {
  // Silent fallback
}

export function setDynamicGithubAppConfig(cfg: GitHubAppConfig | null): void {
  dynamicConfig = cfg;
  try {
    if (cfg) {
      writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
    } else if (existsSync(CONFIG_FILE)) {
      writeFileSync(CONFIG_FILE, '{}', 'utf-8');
    }
  } catch (e) {
    console.error('Failed to persist dynamic GitHub App configuration:', e);
  }
}

/** Read the GitHub App config from env, or null when not configured (off = no GitHub connect). */
export function githubAppConfig(env: NodeJS.ProcessEnv = process.env): GitHubAppConfig | null {
  if (dynamicConfig) return dynamicConfig;
  const appId = env.GITHUB_APP_ID?.trim();
  const rawKey = env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !rawKey) return null;
  // Support both literal newlines and \n-escaped single-line PEMs (common in env vars).
  const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;
  return { appId, privateKey, slug: env.GITHUB_APP_SLUG?.trim() || undefined };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Create a signed App JWT (RS256), valid ~10 minutes. `iat` is backdated 60s to tolerate clock skew,
 * as GitHub recommends.
 */
export function createAppJwt(config: GitHubAppConfig, now: number = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60;
  const exp = iat + 600;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat, exp, iss: config.appId }));
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = base64url(signer.sign(config.privateKey));
  return `${signingInput}.${signature}`;
}

interface CachedToken { token: string; expiresAt: number; }
const tokenCache = new Map<string, CachedToken>();

/** Options seam so tests can inject fetch/config without touching env or the network. */
export interface InstallationTokenOptions {
  config?: GitHubAppConfig | null;
  fetchFn?: typeof fetch;
  now?: () => number;
}

/**
 * Get a fresh installation access token for `installationId`, cached until ~60s before it expires.
 * Throws if the App is not configured or GitHub rejects the exchange.
 */
export async function getInstallationToken(installationId: string, opts: InstallationTokenOptions = {}): Promise<string> {
  const now = opts.now ?? Date.now;
  const config = opts.config ?? githubAppConfig();
  if (!config) throw new Error('GitHub App is not configured (set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY)');
  const fetchFn = opts.fetchFn ?? fetch;

  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - 60_000 > now()) return cached.token;

  const jwt = createAppJwt(config, now());
  const res = await fetchFn(`${GITHUB_API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'agent-os-lobby',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub installation token exchange failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { token: string; expires_at: string };
  if (!data.token) throw new Error('GitHub installation token response missing token');
  tokenCache.set(installationId, { token: data.token, expiresAt: Date.parse(data.expires_at) || (now() + 3_000_000) });
  return data.token;
}

/** Build the App install URL the panel sends the user to (carrying an opaque `state`). */
export function installUrl(config: GitHubAppConfig, state: string): string {
  const slug = config.slug;
  if (!slug) throw new Error('GITHUB_APP_SLUG not set — cannot build the install URL');
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
}

/** Clear the token cache (tests / rotation). */
export function _clearInstallationTokenCache(): void { tokenCache.clear(); }
