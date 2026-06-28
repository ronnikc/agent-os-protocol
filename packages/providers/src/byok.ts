// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * BYOK (bring-your-own-key) helpers. The platform stores only the *name* of the env var that
 * holds a provider key (`ProviderConfig.apiKeyEnv`) — never the key value. Keys are resolved
 * from the local environment at call time and **never** serialized, logged, or sent to a lobby.
 * See IMPLEMENTATION-PLAN.md §6 / charter §13/§19.
 */

import type { ProviderConfig } from '@agent-os/protocol-core';

/** Raised when a provider needs a key but the named env var is unset locally. */
export class MissingApiKeyError extends Error {
  constructor(public readonly apiKeyEnv: string | undefined) {
    super(
      apiKeyEnv
        ? `BYOK: env var ${apiKeyEnv} is not set — the provider key stays local; set it in your shell or .env.`
        : 'BYOK: no apiKeyEnv configured — name the env var that holds your key (the key itself never leaves this machine).',
    );
    this.name = 'MissingApiKeyError';
  }
}

/**
 * Resolve a provider's API key from the local environment by the configured env-var name.
 * Throws MissingApiKeyError when absent. The returned secret must stay in-process.
 */
export function resolveApiKey(
  config: Pick<ProviderConfig, 'apiKeyEnv'>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const name = config.apiKeyEnv;
  const value = name ? env[name] : undefined;
  if (!value) throw new MissingApiKeyError(name);
  return value;
}

/** True when the key named by `apiKeyEnv` is present locally (no value is returned). */
export function hasApiKey(
  config: Pick<ProviderConfig, 'apiKeyEnv'>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(config.apiKeyEnv && env[config.apiKeyEnv]);
}

/**
 * Return a lobby-safe view of a provider config: structural fields only (id, model, baseUrl, and
 * the env-var *name*) — guaranteed to carry no secret value. Use this before any config crosses a
 * process/network boundary.
 */
export function redactProviderConfig(config: ProviderConfig): ProviderConfig {
  return {
    id: config.id,
    model: config.model,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(config.apiKeyEnv ? { apiKeyEnv: config.apiKeyEnv } : {}),
  };
}

/** Heuristics for things that look like real secrets (defensive — config should never hold one). */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/, // OpenAI / Anthropic style
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /ghp_[A-Za-z0-9]{20,}/, // GitHub token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
];

/**
 * Defensive guard: assert a provider config carries no inline secret before it is shared. By the
 * type, `ProviderConfig` has no key field — this catches misuse (e.g. someone stuffing a key into
 * `baseUrl` or a stray field).
 */
export function assertNoInlineSecret(config: ProviderConfig): void {
  const haystack = JSON.stringify(config);
  for (const re of SECRET_PATTERNS) {
    if (re.test(haystack)) {
      throw new Error('BYOK violation: provider config appears to contain an inline secret — keys must come from env only.');
    }
  }
}
