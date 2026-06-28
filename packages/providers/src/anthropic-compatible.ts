// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Anthropic-compatible model provider — fuels an agent via the Messages API
 * (`POST {baseUrl}/v1/messages`). Works with the Anthropic API and any compatible gateway by
 * pointing `baseUrl` at it. BYOK: the key is resolved from the local env at call time and never
 * stored in the config. System turns are hoisted to the top-level `system` field per the API.
 */

import type {
  ModelProviderAdapter,
  ProviderConfig,
  CompletionMessage,
  AgentCompletionRequest,
  AgentCompletionResult,
  AgentCompletionEvent,
  ProviderValidationResult,
  ModelCapabilities,
} from '@agent-os/protocol-core';
import { resolveApiKey, hasApiKey } from './byok.js';
import { readSseData } from './sse.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicCompatibleOptions {
  /** Injected fetch for verification; defaults to the global fetch. */
  fetchFn?: typeof fetch;
  /** `anthropic-version` header (defaults to a known-stable value). */
  anthropicVersion?: string;
  /** Default max output tokens when the request does not constrain it. */
  maxTokens?: number;
}

export class AnthropicCompatibleProvider implements ModelProviderAdapter {
  readonly id = 'anthropic-compatible';
  readonly label = 'Anthropic-compatible API';

  private config?: ProviderConfig;
  private readonly fetchFn: typeof fetch;
  private readonly version: string;
  private readonly maxTokens: number;

  constructor(options: AnthropicCompatibleOptions = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.version = options.anthropicVersion ?? DEFAULT_VERSION;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async configure(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  async validateConfig(config: ProviderConfig): Promise<ProviderValidationResult> {
    if (!config.model) return { ok: false, message: 'no model configured' };
    const base = config.baseUrl ?? DEFAULT_BASE_URL;
    try {
      // eslint-disable-next-line no-new
      new URL(base);
    } catch {
      return { ok: false, message: `invalid baseUrl: ${base}` };
    }
    if (!hasApiKey(config)) {
      return { ok: false, message: `BYOK key env ${config.apiKeyEnv ?? '(unset)'} not present locally` };
    }
    return { ok: true, capabilities: this.capabilities() };
  }

  capabilities(): ModelCapabilities {
    return { toolUse: true, functionCalling: true, streaming: true, jsonMode: false, vision: true };
  }

  private endpoint(): { url: string; headers: Record<string, string> } {
    const config = this.requireConfig();
    const key = resolveApiKey(config); // throws MissingApiKeyError when absent
    const base = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    return {
      url: `${base}/v1/messages`,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': this.version,
      },
    };
  }

  /** Split system turns (hoisted to `system`) from the user/assistant turn list. */
  private splitMessages(messages: CompletionMessage[]): { system?: string; turns: Array<{ role: 'user' | 'assistant'; content: string }> } {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const turns = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content }));
    return { ...(system ? { system } : {}), turns };
  }

  private body(request: AgentCompletionRequest, stream: boolean): string {
    const config = this.requireConfig();
    const { system, turns } = this.splitMessages(request.messages);
    return JSON.stringify({
      model: config.model,
      max_tokens: this.maxTokens,
      ...(system ? { system } : {}),
      messages: turns,
      ...(request.tools ? { tools: request.tools } : {}),
      stream,
    });
  }

  async complete(request: AgentCompletionRequest): Promise<AgentCompletionResult> {
    const { url, headers } = this.endpoint();
    const res = await this.fetchFn(url, { method: 'POST', headers, body: this.body(request, false) });
    if (!res.ok) throw new Error(`anthropic-compatible: ${res.status} ${await safeText(res)}`);
    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const content = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    return {
      content,
      usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
    };
  }

  async *stream(request: AgentCompletionRequest): AsyncIterable<AgentCompletionEvent> {
    const { url, headers } = this.endpoint();
    const res = await this.fetchFn(url, { method: 'POST', headers, body: this.body(request, true) });
    if (!res.ok) {
      yield { type: 'error', content: `anthropic-compatible: ${res.status} ${await safeText(res)}` };
      return;
    }
    for await (const payload of readSseData(res.body)) {
      let evt: { type?: string; delta?: { type?: string; text?: string } };
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
        yield { type: 'text', content: evt.delta.text };
      } else if (evt.type === 'message_stop') {
        break;
      }
    }
    yield { type: 'done' };
  }

  private requireConfig(): ProviderConfig {
    if (!this.config) throw new Error('anthropic-compatible: configure() not called');
    return this.config;
  }
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

export const anthropicCompatibleProvider = new AnthropicCompatibleProvider();
