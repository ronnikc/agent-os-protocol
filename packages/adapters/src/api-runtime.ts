// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

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
import type { ProviderConfig, ModelProviderAdapter, CompletionMessage, AgentCompletionRequest, AgentCompletionResult } from '@agent-os/protocol-core';
import { AnthropicCompatibleProvider, OpenAICompatibleProvider } from '@agent-os/providers';
import { randomUUID } from 'node:crypto';

export interface LobbyToolsProvider {
  getRoster(): Promise<string>;
  sendMessage(toAgentId: string, content: string): Promise<string>;
}

export interface ApiRuntimeConfig {
  /** Provider selection + model + optional base URL. `id` picks the wire format. */
  provider: ProviderConfig;
  /** Raw API key, injected in-process from wallet-scoped custody (hosted) — never from disk here. */
  apiKey: string;
  /** Injected fetch for tests; defaults to the provider's global fetch. */
  fetchFn?: typeof fetch;
  /** Max output tokens (Anthropic requires it; forwarded to the provider). */
  maxTokens?: number;
  guardedCompletion?: (request: AgentCompletionRequest, complete: (request: AgentCompletionRequest) => Promise<AgentCompletionResult>) => Promise<AgentCompletionResult>;
  workSignal?: () => AbortSignal | undefined;
  /** Injected repo client for hosted repository tool-use. */
  repoClient?: any;
  /** Injected lobby tools for roster queries, messaging, and task management. */
  lobbyTools?: LobbyToolsProvider;
  /** Operator-configured proof exchange. The model supplies neither a URL nor key material. */
  accessAgentIdResource?: () => Promise<string>;
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

function buildToolsForProvider(providerId: string, agentIdAccess: boolean): any[] {
  const definitions = [
    {
      name: 'read_file',
      description: 'Read the text content of a file from the repository.',
      properties: {
        path: { type: 'string', description: 'Relative path of the file to read' }
      },
      required: ['path']
    },
    {
      name: 'write_file',
      description: 'Create or update a file in the repository and commit it.',
      properties: {
        path: { type: 'string', description: 'Relative path of the file to write' },
        content: { type: 'string', description: 'File content to write' },
        commit_message: { type: 'string', description: 'Commit message for the change' }
      },
      required: ['path', 'content', 'commit_message']
    },
    {
      name: 'create_pr',
      description: 'Create a new pull request on GitHub for changes.',
      properties: {
        title: { type: 'string', description: 'Title of the pull request' },
        head: { type: 'string', description: 'The name of the branch with changes' },
        base: { type: 'string', description: 'The branch to pull into (e.g., main)' },
        body: { type: 'string', description: 'Optional description of the PR' }
      },
      required: ['title', 'head', 'base']
    },
    {
      name: 'list_files',
      description: 'List files and directories at a given path in the repository.',
      properties: {
        path: { type: 'string', description: 'Optional directory path to list (defaults to root)' }
      },
      required: []
    }
  ];

  // Lobby tools — available to all hosted agents for roster awareness and messaging
  const lobbyToolDefs = [
    {
      name: 'get_roster',
      description: 'Get the current lobby roster: all connected agents with their names, roles, statuses, and current work. Use this to understand who is online and available before coordinating work.',
      properties: {},
      required: [] as string[]
    },
    {
      name: 'send_message',
      description: 'Send a directed message to a specific agent by their agent_id (from get_roster). Use this to assign tasks, request status updates, or coordinate work with individual agents.',
      properties: {
        to_agent_id: { type: 'string', description: 'The agent_id of the target agent (from get_roster output)' },
        content: { type: 'string', description: 'The message content to send' }
      },
      required: ['to_agent_id', 'content']
    }
  ];

  // Combine repo tools + lobby tools based on what's available
  const allDefs = [...definitions, ...lobbyToolDefs];
  if (agentIdAccess) {
    allDefs.push({
      name: 'access_agent_id_resource',
      description: 'Use this agent’s delegated Agent ID to request access to its configured resource.',
      properties: {},
      required: [],
    });
  }

  if (providerId === 'openai-compatible') {
    return allDefs.map(d => ({
      type: 'function',
      function: {
        name: d.name,
        description: d.description,
        parameters: {
          type: 'object',
          properties: d.properties,
          required: d.required
        }
      }
    }));
  } else {
    // Anthropic-compatible
    return allDefs.map(d => ({
      name: d.name,
      description: d.description,
      input_schema: {
        type: 'object',
        properties: d.properties,
        required: d.required
      }
    }));
  }
}

export class ApiRuntimeAdapter implements AgentRuntimeAdapter {
  readonly id = 'api' as const;
  readonly label = 'API runtime (server-side)';
  readonly supportsInteractiveMode = true;
  readonly supportsHeadlessMode = true;
  readonly supportsJsonOutput = true;
  readonly supportsSessionResume = true;
  get supportsMcp(): boolean {
    return !!(this.cfg.repoClient || this.cfg.lobbyTools || this.cfg.accessAgentIdResource);
  }

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

  private async executeTool(name: string, args: any): Promise<string> {
    if (name === 'access_agent_id_resource') {
      return this.cfg.accessAgentIdResource?.() ?? 'Agent ID proof access is not configured.';
    }
    // Lobby tools — always available when lobbyTools is configured
    if (name === 'get_roster') {
      if (!this.cfg.lobbyTools) return 'Lobby tools not available.';
      return this.cfg.lobbyTools.getRoster();
    }
    if (name === 'send_message') {
      if (!this.cfg.lobbyTools) return 'Lobby tools not available.';
      return this.cfg.lobbyTools.sendMessage(args.to_agent_id, args.content);
    }

    // Repo tools — require repoClient
    const client = this.cfg.repoClient;
    if (!client) {
      throw new Error(`repoClient is not configured for executing tool: ${name}`);
    }
    switch (name) {
      case 'read_file': {
        const content = await client.readFile(args.path);
        return content;
      }
      case 'write_file': {
        const commitSha = await client.writeFile(args.path, args.content, args.commit_message);
        return `Successfully wrote file. Commit SHA: ${commitSha}`;
      }
      case 'create_pr': {
        const prUrl = await client.createPullRequest(args.title, args.head, args.base, args.body);
        return `Successfully created pull request: ${prUrl}`;
      }
      case 'list_files': {
        const files = await client.listFiles(args.path || '');
        return files.join('\n');
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async *readOutput(handle: AgentProcessHandle): AsyncIterable<RuntimeEvent> {
    const s = this.sessions.get(handle.id);
    if (!s) { yield { type: 'error', content: `unknown session: ${handle.id}` }; return; }
    const next = s.queue.shift();
    if (next === undefined) { yield { type: 'done' }; return; }

    s.messages.push({ role: 'user', content: next });

    if (!this.cfg.guardedCompletion && !this.cfg.repoClient && !this.cfg.accessAgentIdResource) {
      // Normal streaming path when no repoClient is injected
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
      if (assistant) s.messages.push({ role: 'assistant', content: assistant });
      yield { type: 'done', content: assistant };
      return;
    }

    // Repo client tool loop (non-streaming intermediate turns, final turn yields output)
    const tools = this.cfg.repoClient || this.cfg.accessAgentIdResource
      ? buildToolsForProvider(this.cfg.provider.id, !!this.cfg.accessAgentIdResource) : undefined;
    const signal = this.cfg.workSignal?.();
    let assistantText = '';
    let loopCount = 0;
    const maxLoops = 10;

    while (loopCount < maxLoops) {
      if (s.aborted) { yield { type: 'error', content: 'aborted' }; return; }

      const messages: CompletionMessage[] = [
        ...(s.system ? [{ role: 'system' as const, content: s.system }] : []),
        ...s.messages,
      ];

      yield { type: 'status', content: 'Thinking...' };

      let result: any;
      try {
        const request = { messages, tools };
        result = this.cfg.guardedCompletion
          ? await this.cfg.guardedCompletion(request, input => this.provider.complete(input))
          : await this.provider.complete(request);
      } catch (err) {
        yield { type: 'error', content: err instanceof Error ? err.message : 'Provider execution error' };
        yield { type: 'done' };
        return;
      }

      if (s.aborted || signal?.aborted) { yield { type: 'error', content: 'aborted' }; return; }

      if (result.content) {
        assistantText += result.content;
        yield { type: 'output', content: result.content };
      }

      if (tools && result.toolCalls && result.toolCalls.length > 0) {
        s.messages.push({
          role: 'assistant',
          content: result.content || '',
          tool_calls: result.toolCalls,
        });

        for (const tc of result.toolCalls) {
          if (s.aborted || signal?.aborted) { yield { type: 'error', content: 'aborted' }; return; }
          yield { type: 'tool_call', content: `Calling tool ${tc.name}`, data: tc };
          try {
            const output = await this.executeTool(tc.name, tc.arguments);
            s.messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.name,
              content: output,
            });
            yield { type: 'status', content: `Tool ${tc.name} returned output` };
          } catch (err: any) {
            s.messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.name,
              content: `Error: ${err.message}`,
            });
            yield { type: 'status', content: `Tool ${tc.name} failed: ${err.message}` };
          }
        }
        loopCount++;
      } else {
        s.messages.push({
          role: 'assistant',
          content: result.content || '',
        });
        break;
      }
    }

    yield { type: 'done', content: assistantText.trim() };
  }
}

/** Factory — the lobby constructs one per launched server-side agent with its resolved key. */
export function createApiRuntimeAdapter(cfg: ApiRuntimeConfig): ApiRuntimeAdapter {
  return new ApiRuntimeAdapter(cfg);
}
