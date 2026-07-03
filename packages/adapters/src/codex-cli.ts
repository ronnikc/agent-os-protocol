// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Codex CLI runtime adapter — the second first-class adapter, driving OpenAI's Codex CLI
 * (`@openai/codex`) in non-interactive ("exec") mode. Implements the AgentRuntimeAdapter
 * contract from @agent-os/protocol-core, so the relay/lobby/panel drive it through the same
 * stable interface as Claude CLI.
 *
 * Unlike the Claude adapter (which embeds the Claude Agent SDK in-process), Codex ships no
 * in-process Node driver — its own SDK just shells out to the same binary. So this adapter
 * spawns the user-installed `codex` binary directly (detected on PATH, never bundled) and
 * parses the JSONL event stream from `codex exec --experimental-json`. Every flag and event
 * mapping below is grounded in the live Codex source — see docs/adapters/codex-cli.md for the
 * discovery spike.
 */

import { execSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type {
  AgentRuntimeAdapter,
  RuntimeDetectionResult,
  StartAgentConfig,
  AgentProcessHandle,
  RuntimeMessage,
  RuntimeEvent,
} from '@agent-os/protocol-core';

/** Resolve the `codex` executable (or fall back to the bare command on PATH). */
export function resolveCodexPath(): string {
  const command = process.platform === 'win32' ? 'where codex' : 'which codex';
  try {
    return execSync(command, { encoding: 'utf8' }).trim().split(/\r?\n/)[0].trim();
  } catch {
    return process.platform === 'win32' ? 'codex.exe' : 'codex';
  }
}

// ── Codex `exec --experimental-json` event schema (subset we map) ──
// Source of truth: openai/codex sdk/typescript/src/{events,items}.ts. Top-level thread events
// carry a `type`; the three `item.*` events wrap a `ThreadItem` whose own `type` discriminates
// the kind of work (assistant message, reasoning, tool/command, etc.).

/** A Codex `ThreadItem` — the discriminator is its own `type` field. */
export interface CodexThreadItem {
  type: string;
  id?: string;
  /** Present on `agent_message` (assistant text) and `reasoning` (thinking). */
  text?: string;
  command?: string;
  status?: string;
  exit_code?: number;
  server?: string;
  tool?: string;
  query?: string;
  message?: string;
  [k: string]: unknown;
}

/** A top-level Codex thread event from the JSONL stream. */
export interface CodexEvent {
  type: string;
  /** On `thread.started` — the resumable thread/session id. */
  thread_id?: string;
  /** On `item.*` — the wrapped work item. */
  item?: CodexThreadItem;
  /** On `turn.failed`. */
  error?: { message?: string };
  /** On the top-level `error` event. */
  message?: string;
  /** On `turn.completed`. */
  usage?: unknown;
  [k: string]: unknown;
}

/** The result of mapping one Codex event onto the runtime-agnostic event contract. */
export interface MappedCodexEvent {
  /** The RuntimeEvent to surface, or null to ignore (e.g. streaming item.started/updated). */
  event: RuntimeEvent | null;
  /** Set on `thread.started` — captured into the session so the next turn can `resume`. */
  threadId?: string;
  /** True at a turn boundary (`turn.completed` / `turn.failed`). */
  terminal?: boolean;
}

/**
 * Pure mapping from a Codex thread event to a runtime-agnostic RuntimeEvent. Kept side-effect
 * free so it can be unit-verified without spawning a process. We emit text/tool events only on
 * `item.completed` (the final, settled item) to avoid duplicating the streaming
 * `item.started` / `item.updated` deltas.
 */
export function mapCodexEvent(evt: CodexEvent): MappedCodexEvent {
  switch (evt.type) {
    case 'thread.started':
      return {
        event: { type: 'status', content: 'session started', data: { thread_id: evt.thread_id } },
        threadId: evt.thread_id,
      };
    case 'turn.started':
      return { event: null };
    case 'turn.completed':
      return { event: { type: 'status', content: 'turn complete', data: { usage: evt.usage } }, terminal: true };
    case 'turn.failed':
      return { event: { type: 'error', content: evt.error?.message ?? 'turn failed' }, terminal: true };
    case 'error':
      return { event: { type: 'error', content: evt.message ?? 'codex error' } };
    case 'item.started':
    case 'item.updated':
      // Streaming deltas — ignored; we surface the settled item on `item.completed`.
      return { event: null };
    case 'item.completed':
      return { event: mapCodexItem(evt.item) };
    default:
      return { event: null };
  }
}

/** Map a completed Codex `ThreadItem` to a RuntimeEvent (or null when not worth surfacing). */
function mapCodexItem(item: CodexThreadItem | undefined): RuntimeEvent | null {
  if (!item) return null;
  switch (item.type) {
    case 'agent_message':
      return { type: 'output', content: item.text ?? '' };
    case 'reasoning':
      return { type: 'thinking', content: item.text ?? '' };
    case 'command_execution':
      return { type: 'tool_call', content: item.command ?? 'command', data: item };
    case 'mcp_tool_call':
      return { type: 'tool_call', content: `${item.server ?? 'mcp'}/${item.tool ?? 'tool'}`, data: item };
    case 'file_change':
      return { type: 'tool_call', content: 'file_change', data: item };
    case 'web_search':
      return { type: 'tool_call', content: item.query ? `web_search: ${item.query}` : 'web_search', data: item };
    case 'todo_list':
      return { type: 'status', content: 'todo_list', data: item };
    case 'error':
      return { type: 'error', content: item.message ?? 'item error' };
    default:
      return null;
  }
}

// ── Spawn seam (injectable for verification without a real `codex` binary) ──

/** The minimal child-process surface this adapter needs; satisfied by Node's ChildProcess. */
export interface ChildLike {
  stdout: Readable | null;
  stdin: Writable | null;
  stderr: Readable | null;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'close', listener: (code: number | null) => void): this;
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildLike;

export interface CodexAdapterOptions {
  /** Override the resolved `codex` binary path (defaults to PATH lookup). */
  binPath?: string;
  /**
   * JSON event-stream flag. Defaults to `--experimental-json` (what OpenAI's own SDK sends on
   * `main`); newer Codex builds alias it to `--json` — override here if your install needs it.
   */
  jsonFlag?: '--experimental-json' | '--json';
  /** Codex sandbox mode. Defaults to `workspace-write` so the agent can edit files in its cwd. */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** Optional model override (`--model`). */
  model?: string;
  /** Injected spawn for verification; defaults to node:child_process spawn. */
  spawnFn?: SpawnFn;
}

interface Session {
  cwd: string;
  systemPrompt?: string;
  env?: Record<string, string>;
  /** Per-session model override (StartAgentConfig.model) — wins over the adapter-level option. */
  model?: string;
  queue: string[];
  /** Captured from `thread.started`; subsequent turns `resume` it for multi-turn continuity. */
  threadId?: string;
  aborted: boolean;
}

export class CodexCliAdapter implements AgentRuntimeAdapter {
  readonly id = 'codex-cli';
  readonly label = 'Codex CLI (OpenAI)';
  readonly supportsInteractiveMode = true;
  readonly supportsHeadlessMode = true;
  readonly supportsJsonOutput = true;
  readonly supportsSessionResume = true;
  readonly supportsMcp = true;

  private sessions = new Map<string, Session>();

  constructor(private readonly options: CodexAdapterOptions = {}) {}

  async detect(): Promise<RuntimeDetectionResult> {
    const path = this.options.binPath ?? resolveCodexPath();
    try {
      const version = execSync(`${path} --version`, { encoding: 'utf8', stdio: 'pipe' }).trim();
      return { installed: true, version, path };
    } catch {
      return {
        installed: false,
        path,
        message:
          'Codex CLI not found. Install with `npm install -g @openai/codex`, then run `codex` to sign in with ChatGPT (or set OPENAI_API_KEY).',
      };
    }
  }

  async startAgent(config: StartAgentConfig): Promise<AgentProcessHandle> {
    const id = randomUUID();
    this.sessions.set(id, {
      cwd: config.cwd,
      systemPrompt: config.systemPrompt,
      env: config.env,
      model: config.model,
      queue: [],
      threadId: config.resumeSessionId,
      aborted: false,
    });
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

  /** Build the `codex exec` argv for one turn (visible for verification). */
  buildExecArgs(session: { cwd: string; threadId?: string; model?: string }): string[] {
    const args = ['exec', this.options.jsonFlag ?? '--experimental-json'];
    const model = session.model ?? this.options.model;
    if (model) args.push('--model', model);
    args.push('--sandbox', this.options.sandbox ?? 'workspace-write');
    args.push('--cd', session.cwd);
    // Codex `exec` refuses to run outside a git repo by default; the adapter operates in
    // arbitrary project roots, so opt out of that guard explicitly.
    args.push('--skip-git-repo-check');
    // Continue a prior thread when we have one (mirrors the SDK's resume-as-subcommand form).
    if (session.threadId) args.push('resume', session.threadId);
    return args;
  }

  async *readOutput(handle: AgentProcessHandle): AsyncIterable<RuntimeEvent> {
    const s = this.sessions.get(handle.id);
    if (!s) {
      yield { type: 'error', content: `unknown session: ${handle.id}` };
      return;
    }
    const next = s.queue.shift();
    if (next === undefined) {
      yield { type: 'done' };
      return;
    }

    const prompt = s.systemPrompt ? `${s.systemPrompt}\n\n${next}` : next;
    const bin = this.options.binPath ?? resolveCodexPath();
    const args = this.buildExecArgs(s);
    const spawnFn: SpawnFn = this.options.spawnFn ?? (spawn as unknown as SpawnFn);
    const child = spawnFn(bin, args, {
      cwd: s.cwd,
      env: { ...process.env, ...s.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Codex `exec` reads the prompt from stdin when no positional prompt is given.
    child.stdin?.write(prompt);
    child.stdin?.end();

    let stderr = '';
    child.stderr?.on('data', (d: Buffer | string) => {
      stderr += d.toString();
    });

    let sawError = false;
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
      try {
        for await (const line of rl) {
          if (s.aborted) {
            child.kill('SIGTERM');
            yield { type: 'error', content: 'aborted' };
            return;
          }
          const trimmed = line.trim();
          if (!trimmed) continue;
          let evt: CodexEvent;
          try {
            evt = JSON.parse(trimmed) as CodexEvent;
          } catch {
            continue; // ignore any non-JSON noise on stdout
          }
          const mapped = mapCodexEvent(evt);
          if (mapped.threadId) s.threadId = mapped.threadId;
          if (mapped.event) {
            if (mapped.event.type === 'error') sawError = true;
            yield mapped.event;
          }
        }
      } finally {
        rl.close();
      }
    }

    const code = await waitForExit(child);
    if (code !== 0 && !sawError) {
      yield { type: 'error', content: stderr.trim() || `codex exec exited with code ${code}` };
    }
    yield { type: 'done' };
  }
}

/** Resolve the child's exit code, whether it has already exited or is still running. */
function waitForExit(child: ChildLike): Promise<number> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise<number>((res) => child.on('close', (c) => res(c ?? 0)));
}

export const codexCliAdapter = new CodexCliAdapter();
