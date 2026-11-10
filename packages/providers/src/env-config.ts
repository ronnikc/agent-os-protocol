// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * Build per-provider configs from conventional environment variables. This keeps the env-var
 * naming convention in one place (out of the generic registry) so the panel/relay can discover
 * "which providers are configured locally" without hardcoding it. Only env-var *names* and
 * non-secret fields are produced — never a key value (BYOK).
 */

import type { ProviderConfig } from '@agent-os/protocol-core';

interface ProviderEnvConvention {
  apiKeyEnv: string;
  baseUrlEnv: string;
  modelEnv: string;
  defaultModel: string;
}

const CONVENTIONS: Record<string, ProviderEnvConvention> = {
  'openai-compatible': {
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrlEnv: 'OPENAI_BASE_URL',
    modelEnv: 'OPENAI_MODEL',
    defaultModel: 'gpt-4o-mini',
  },
  'anthropic-compatible': {
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    modelEnv: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-sonnet-4-6',
  },
};

/** Resolve default `ProviderConfig`s (keyed by provider id) from the local environment. */
export function loadProviderConfigsFromEnv(env: NodeJS.ProcessEnv = process.env): Record<string, ProviderConfig> {
  const out: Record<string, ProviderConfig> = {};
  for (const [id, c] of Object.entries(CONVENTIONS)) {
    out[id] = {
      id,
      apiKeyEnv: c.apiKeyEnv,
      model: env[c.modelEnv] || c.defaultModel,
      ...(env[c.baseUrlEnv] ? { baseUrl: env[c.baseUrlEnv] } : {}),
    };
  }
  return out;
}

/** The default provider id, from `AGENT_OS_PROVIDER` (falls back to openai-compatible). */
export function defaultProviderId(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENT_OS_PROVIDER || 'openai-compatible';
}
