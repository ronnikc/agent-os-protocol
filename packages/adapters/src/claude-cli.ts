// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Claude CLI runtime adapter — the first-class adapter that drives Claude Code via the
 * Claude Agent SDK. Implements the AgentRuntimeAdapter contract from @agent-os/protocol-core.
 * Extracted from the relay so the relay/lobby never hardwire to a single runtime.
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentRuntimeAdapter,
  RuntimeDetectionResult,
  StartAgentConfig,
  AgentProcessHandle,
  RuntimeMessage,
  RuntimeEvent,
} from '@agent-os/protocol-core';

/** Resolve the `claude` executable (or fall back to the bare command on PATH). */
export function resolveClaudePath(): string {
  const command = process.platform === 'win32' ? 'where claude' : 'which claude';
  try {
    return execSync(command, { encoding: 'utf8' }).trim().split(/\r?\n/)[0].trim();
  } catch {
    return 'claude';
  }
}

interface Session {
  cwd: string;
  systemPrompt?: string;
  queue: string[];
  aborted: boolean;
}

export class ClaudeCliAdapter implements AgentRuntimeAdapter {
  readonly id = 'claude-cli';
  readonly label = 'Claude Code (CLI)';
  readonly supportsInteractiveMode = true;
  readonly supportsHeadlessMode = true;
  readonly supportsJsonOutput = true;
  readonly supportsSessionResume = true;
  readonly supportsMcp = true;

  private sessions = new Map<string, Session>();

  async detect(): Promise<RuntimeDetectionResult> {
    const path = resolveClaudePath();
    try {
      const version = execSync(`${path} --version`, { encoding: 'utf8', stdio: 'pipe' }).trim();
      return { installed: true, version, path };
    } catch {
      return {
        installed: false,
        path,
        message:
          'Claude CLI not found. Install with `npm install -g @anthropic-ai/claude-code`, then `claude login`.',
      };
    }
  }

  async startAgent(config: StartAgentConfig): Promise<AgentProcessHandle> {
    const id = randomUUID();
    this.sessions.set(id, {
      cwd: config.cwd,
      systemPrompt: config.systemPrompt,
      queue: [],
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
    const result = query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: resolveClaudePath(),
        permissionMode: 'bypassPermissions',
        cwd: s.cwd,
      } as Options,
    });
    for await (const message of result) {
      if (s.aborted) {
        yield { type: 'error', content: 'aborted' };
        return;
      }
      const m = message as { type?: string; message?: { content?: Array<Record<string, unknown>> } };
      if (m.type === 'assistant') {
        for (const block of m.message?.content ?? []) {
          if (block.type === 'text' && typeof block.text === 'string') {
            yield { type: 'output', content: block.text };
          } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
            yield { type: 'thinking', content: block.thinking };
          } else if (block.type === 'tool_use') {
            yield { type: 'tool_call', data: block };
          }
        }
      }
    }
    yield { type: 'done' };
  }
}

export const claudeCliAdapter = new ClaudeCliAdapter();
