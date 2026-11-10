// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * OpenAI-compatible model provider — fuels an agent via the Chat Completions API
 * (`POST {baseUrl}/chat/completions`). Works with OpenAI and any compatible gateway/local server
 * (OpenRouter, Together, vLLM, LM Studio, Ollama's OpenAI shim, …) by pointing `baseUrl` at it.
 * BYOK: the key is resolved from the local env at call time and never stored in the config.
 */

import type {
  ModelProviderAdapter,
  ProviderConfig,
  AgentCompletionRequest,
  AgentCompletionResult,
  AgentCompletionEvent,
  ProviderValidationResult,
  ModelCapabilities,
} from '@agent-os/protocol-core';
import { resolveApiKey, hasApiKey } from './byok.js';
import { readSseData } from './sse.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export interface OpenAICompatibleOptions {
  /** Injected fetch for verification; defaults to the global fetch. */
  fetchFn?: typeof fetch;
  /**
   * Directly-injected API key for HOSTED (server-side) execution, where the key comes from
   * wallet-scoped custody in-process. When set, it overrides the BYOK env lookup. Local Mode
   * leaves this unset (keys stay env-local). Must stay in-process: never logged or serialized.
   */
  apiKey?: string;
}

export class OpenAICompatibleProvider implements ModelProviderAdapter {
  readonly id = 'openai-compatible';
  readonly label = 'OpenAI-compatible API';

  private config?: ProviderConfig;
  private readonly fetchFn: typeof fetch;
  private readonly injectedKey?: string;

  constructor(options: OpenAICompatibleOptions = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.injectedKey = options.apiKey;
  }

  async configure(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  /** Static, offline validation: model set, baseUrl well-formed, and the BYOK key present locally. */
  async validateConfig(config: ProviderConfig): Promise<ProviderValidationResult> {
    if (!config.model) return { ok: false, message: 'no model configured' };
    const base = config.baseUrl ?? DEFAULT_BASE_URL;
    try {
      // eslint-disable-next-line no-new
      new URL(base);
    } catch {
      return { ok: false, message: `invalid baseUrl: ${base}` };
    }
    if (!this.injectedKey && !hasApiKey(config)) {
      return { ok: false, message: `BYOK key env ${config.apiKeyEnv ?? '(unset)'} not present locally` };
    }
    return { ok: true, capabilities: this.capabilities() };
  }

  capabilities(): ModelCapabilities {
    return { toolUse: true, functionCalling: true, streaming: true, jsonMode: true, vision: true };
  }

  private endpoint(): { url: string; headers: Record<string, string> } {
    const config = this.requireConfig();
    // Hosted: use the directly-injected key; Local BYOK: resolve from the env var by name.
    const key = this.injectedKey ?? resolveApiKey(config); // resolveApiKey throws when absent
    const base = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    return {
      url: `${base}/chat/completions`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    };
  }

  private body(request: AgentCompletionRequest, stream: boolean): string {
    const config = this.requireConfig();
    const messages = request.messages.map((m) => {
      const msg: any = { role: m.role, content: m.content };
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
          },
        }));
      }
      if (m.role === 'tool') {
        msg.tool_call_id = m.tool_call_id;
        msg.name = m.name;
      }
      return msg;
    });

    return JSON.stringify({
      model: config.model,
      messages,
      ...(request.tools ? { tools: request.tools } : {}),
      ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      stream,
    });
  }

  async complete(request: AgentCompletionRequest): Promise<AgentCompletionResult> {
    const { url, headers } = this.endpoint();
    const res = await this.fetchFn(url, { method: 'POST', headers, body: this.body(request, false) });
    if (!res.ok) throw new Error(`openai-compatible: ${res.status} ${await safeText(res)}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: any[] } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = data.choices?.[0]?.message;
    const content = choice?.content ?? '';
    const toolCalls = choice?.tool_calls?.map((tc) => {
      let args = {};
      try {
        args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
      } catch {}
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: args,
      };
    });
    return {
      content,
      usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  async *stream(request: AgentCompletionRequest): AsyncIterable<AgentCompletionEvent> {
    const { url, headers } = this.endpoint();
    const res = await this.fetchFn(url, { method: 'POST', headers, body: this.body(request, true) });
    if (!res.ok) {
      yield { type: 'error', content: `openai-compatible: ${res.status} ${await safeText(res)}` };
      return;
    }
    for await (const payload of readSseData(res.body)) {
      if (payload === '[DONE]') break;
      let evt: { choices?: Array<{ delta?: { content?: string } }> };
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = evt.choices?.[0]?.delta?.content;
      if (delta) yield { type: 'text', content: delta };
    }
    yield { type: 'done' };
  }

  private requireConfig(): ProviderConfig {
    if (!this.config) throw new Error('openai-compatible: configure() not called');
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

export const openAICompatibleProvider = new OpenAICompatibleProvider();
