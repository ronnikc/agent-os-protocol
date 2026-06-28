// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Model-provider registry — the panel/relay use this to discover configured API providers.
 * Mirrors the runtime AdapterRegistry: a provider that is unconfigured or missing its BYOK key is
 * *reported* (not fatal), and one provider's failure never breaks the others.
 */

import type { ModelProviderAdapter, ProviderId, ProviderConfig, ProviderValidationResult } from '@agent-os/protocol-core';
import { openAICompatibleProvider } from './openai-compatible.js';
import { anthropicCompatibleProvider } from './anthropic-compatible.js';

export class ProviderRegistry {
  private providers = new Map<ProviderId, ModelProviderAdapter>();

  register(provider: ModelProviderAdapter): this {
    this.providers.set(provider.id, provider);
    return this;
  }

  get(id: ProviderId): ModelProviderAdapter | undefined {
    return this.providers.get(id);
  }

  list(): ModelProviderAdapter[] {
    return [...this.providers.values()];
  }

  /**
   * Validate every registered provider against the supplied per-provider configs (keyed by
   * provider id). Unconfigured providers report `not configured`; one provider throwing never
   * breaks the rest. Static/offline — no network or key value leaves the process.
   */
  async validateAll(configs: Record<string, ProviderConfig>): Promise<Record<string, ProviderValidationResult>> {
    const out: Record<string, ProviderValidationResult> = {};
    for (const provider of this.providers.values()) {
      const config = configs[provider.id];
      if (!config) {
        out[provider.id] = { ok: false, message: 'not configured' };
        continue;
      }
      try {
        out[provider.id] = await provider.validateConfig(config);
      } catch (err) {
        out[provider.id] = { ok: false, message: `validate failed: ${(err as Error).message}` };
      }
    }
    return out;
  }
}

/** The default registry — OpenAI-compatible and Anthropic-compatible providers. */
export const providerRegistry = new ProviderRegistry()
  .register(openAICompatibleProvider)
  .register(anthropicCompatibleProvider);
