// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * API runtime adapter (`id: 'api'`) — drives an agent turn against a model provider's HTTP API
 * directly (Anthropic- or OpenAI-compatible), with NO local CLI. This is what lets a no-local-setup
 * user run agents server-side from the hosted lobby: the lobby resolves the wallet-scoped provider
 * key from custody and injects it here, and this adapter streams the model's output.
 *
 * It implements the same AgentRuntimeAdapter contract as claude-cli/codex-cli — startAgent →
 * sendInput (queue a turn) → readOutput (stream that turn) — so the relay's existing driver works
 * unchanged. Conversation continuity is kept per session: the system prompt plus prior turns are
 * replayed on each request, and the assistant reply is appended for the next turn.
 *
 * The provider adapters live in @agent-os/providers; this wraps one with the injected key. The key
 * stays in-process (never logged/serialized) — enforced by the provider's `apiKey` injection path.
 */

import type {
  AgentRuntimeAdapter, AgentProcessHandle, StartAgentConfig, RuntimeDetectionResult, RuntimeMessage, RuntimeEvent,
} from '@agent-os/protocol-core';
import type { ProviderConfig, ModelProviderAdapter, CompletionMessage } from '@agent-os/protocol-core';
import { AnthropicCompatibleProvider, OpenAICompatibleProvider } from '@agent-os/providers';
import { randomUUID } from 'node:crypto';

export interface ApiRuntimeConfig {
  /** Provider selection + model + optional base URL. `id` picks the wire format. */
  provider: ProviderConfig;
  /** Raw API key, injected in-process from wallet-scoped custody (hosted) — never from disk here. */
  apiKey: string;
  /** Injected fetch for tests; defaults to the provider's global fetch. */
  fetchFn?: typeof fetch;
  /** Max output tokens (Anthropic requires it; forwarded to the provider). */
  maxTokens?: number;
}

interface Session {
  system?: string;
  messages: CompletionMessage[];
  queue: string[];
  aborted: boolean;
}

/** Build the concrete provider for a config, with the key injected (never read from env). */
function providerFor(cfg: ApiRuntimeConfig): ModelProviderAdapter {
  const opts = { fetchFn: cfg.fetchFn, apiKey: cfg.apiKey };
  if (cfg.provider.id === 'openai-compatible') return new OpenAICompatibleProvider(opts);
  // Default to Anthropic-compatible (also the Claude API).
  return new AnthropicCompatibleProvider({ ...opts, maxTokens: cfg.maxTokens });
}

export class ApiRuntimeAdapter implements AgentRuntimeAdapter {
  readonly id = 'api' as const;
  readonly label = 'API runtime (server-side)';
  readonly supportsInteractiveMode = true;
  readonly supportsHeadlessMode = true;
  readonly supportsJsonOutput = true;
  readonly supportsSessionResume = true;
  readonly supportsMcp = false;

  private readonly provider: ModelProviderAdapter;
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly cfg: ApiRuntimeConfig) {
    this.provider = providerFor(cfg);
    void this.provider.configure(cfg.provider);
  }

  async detect(): Promise<RuntimeDetectionResult> {
    // "Installed" = the runtime can make a request: a key is injected and the config validates.
    if (!this.cfg.apiKey) return { installed: false, message: 'no API key injected for the API runtime' };
    const v = await this.provider.validateConfig(this.cfg.provider);
    return v.ok
      ? { installed: true, version: `${this.provider.label} · ${this.cfg.provider.model}` }
      : { installed: false, message: v.message };
  }

  async startAgent(config: StartAgentConfig): Promise<AgentProcessHandle> {
    const id = randomUUID();
    this.sessions.set(id, { system: config.systemPrompt, messages: [], queue: [], aborted: false });
    return { id, runtime: this.id };
  }

  async stopAgent(handle: AgentProcessHandle): Promise<void> {
    const s = this.sessions.get(handle.id);
    if (s) s.aborted = true;
    this.sessions.delete(handle.id);
  }

  async sendInput(handle: AgentProcessHandle, message: RuntimeMessage): Promise<void> {
    const s = this.sessions.get(handle.id);
    if (!s) throw new Error(`unknown session: ${handle.id}`);
    s.queue.push(message.content);
  }

  async *readOutput(handle: AgentProcessHandle): AsyncIterable<RuntimeEvent> {
    const s = this.sessions.get(handle.id);
    if (!s) { yield { type: 'error', content: `unknown session: ${handle.id}` }; return; }
    const next = s.queue.shift();
    if (next === undefined) { yield { type: 'done' }; return; }

    // Assemble the request: system prompt (once, as a system message) + full prior turn history
    // + this turn's user input. The provider hoists system messages itself.
    s.messages.push({ role: 'user', content: next });
    const messages: CompletionMessage[] = [
      ...(s.system ? [{ role: 'system' as const, content: s.system }] : []),
      ...s.messages,
    ];

    let assistant = '';
    try {
      for await (const ev of this.provider.stream({ messages, stream: true })) {
        if (s.aborted) { yield { type: 'error', content: 'aborted' }; return; }
        if (ev.type === 'text' && ev.content) { assistant += ev.content; yield { type: 'output', content: ev.content }; }
        else if (ev.type === 'error') { yield { type: 'error', content: ev.content ?? 'provider error' }; }
      }
    } catch (err) {
      yield { type: 'error', content: err instanceof Error ? err.message : 'API runtime error' };
      yield { type: 'done' };
      return;
    }

    // Keep conversation continuity for the next turn.
    if (assistant) s.messages.push({ role: 'assistant', content: assistant });
    yield { type: 'done', content: assistant };
  }
}

/** Factory — the lobby constructs one per launched server-side agent with its resolved key. */
export function createApiRuntimeAdapter(cfg: ApiRuntimeConfig): ApiRuntimeAdapter {
  return new ApiRuntimeAdapter(cfg);
}
