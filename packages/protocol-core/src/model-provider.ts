// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Model provider (API fuel) contract — for fueling agents directly via an
 * OpenAI-compatible or Anthropic-compatible API instead of a CLI. Separate from
 * AgentRuntimeAdapter. BYOK; keys stay local. See IMPLEMENTATION-PLAN.md §6 / charter §13.
 */

export type ProviderId = 'openai-compatible' | 'anthropic-compatible' | (string & {});

export interface ProviderConfig {
  id: ProviderId;
  /** Base URL of the API (for local models / gateways). */
  baseUrl?: string;
  /** Name of the env var holding the key — the key itself never leaves the local machine. */
  apiKeyEnv?: string;
  model: string;
}

export interface ModelCapabilities {
  toolUse?: boolean;
  functionCalling?: boolean;
  contextLength?: number;
  streaming?: boolean;
  jsonMode?: boolean;
  vision?: boolean;
  codeExecution?: boolean;
}

export interface CompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface AgentCompletionRequest {
  messages: CompletionMessage[];
  tools?: unknown[];
  jsonMode?: boolean;
  stream?: boolean;
}

export interface AgentCompletionResult {
  content: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AgentCompletionEvent {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content?: string;
}

export interface ProviderValidationResult {
  ok: boolean;
  message?: string;
  capabilities?: ModelCapabilities;
}

/** The contract every model-provider adapter implements. */
export interface ModelProviderAdapter {
  id: ProviderId;
  label: string;
  configure(config: ProviderConfig): Promise<void>;
  complete(request: AgentCompletionRequest): Promise<AgentCompletionResult>;
  stream(request: AgentCompletionRequest): AsyncIterable<AgentCompletionEvent>;
  validateConfig(config: ProviderConfig): Promise<ProviderValidationResult>;
}
