// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * HostedAgentRunner — a server-side agent that runs on the lobby host (no local machine, no relay),
 * driven by an injected AgentRuntimeAdapter (the `api` runtime in Hosted Mode). It keeps one
 * persistent adapter session for conversation continuity and turns an inbound lobby message into a
 * reply by running one adapter turn.
 *
 * This is the pure execution core; the lobby server wires it to the coordinator via a virtual
 * socket (register → deliver messages → post replies). Kept adapter-generic and side-effect-free
 * so it is unit-testable with a mock provider.
 */

import type { AgentRuntimeAdapter, AgentProcessHandle } from '@agent-os/protocol-core';

export interface HostedAgentOptions {
  systemPrompt?: string;
  cwd?: string;
  workSignal?: () => AbortSignal | undefined;
  run?: <T>(taskId: string | undefined, work: () => Promise<T>) => Promise<T>;
}

export class HostedAgentRunner {
  private handle?: AgentProcessHandle;
  private turn?: Promise<string>;
  private tasks?: Promise<void>;

  constructor(private readonly adapter: AgentRuntimeAdapter, private readonly opts: HostedAgentOptions = {}) {}

  /** Open the adapter session. Idempotent. */
  async start(): Promise<void> {
    if (this.handle) return;
    this.handle = await this.adapter.startAgent({ cwd: this.opts.cwd ?? '/hosted', systemPrompt: this.opts.systemPrompt });
  }

  /** True while a turn is in flight — callers that must not drop work (task execution) wait on it. */
  get signal(): AbortSignal | undefined { return this.opts.workSignal?.(); }

  get busy(): boolean { return !!(this.turn || this.tasks); }

  /** Reserve the runner for a task, including preparation and follow-up turns. */
  runTask(work: (respond: (content: string) => Promise<string>) => Promise<void>, taskId?: string): Promise<void> {
    const pending = this.tasks ?? this.turn?.then(() => {}, () => {});
    const task = Promise.resolve(pending)
      .then(() => this.withRun(taskId, () => work(content => this.runTurn(content))))
      .finally(() => { if (this.tasks === tail) this.tasks = undefined; });
    const tail = task.then(() => {}, () => {});
    this.tasks = tail;
    return task;
  }

  /**
   * Run one turn for an inbound message and return the reply text ('' if none). Serialised: a
   * second call while a turn is in flight is skipped (returns '') so a burst of messages can't
   * interleave turns on the single session.
   */
  async respondTo(content: string): Promise<string> {
    if (this.busy) return '';
    const turn = this.withRun(undefined, () => this.runTurn(content));
    this.turn = turn;
    try {
      return await turn;
    } finally {
      this.turn = undefined;
    }
  }

  private withRun<T>(taskId: string | undefined, work: () => Promise<T>): Promise<T> {
    return this.opts.run ? this.opts.run(taskId, work) : work();
  }

  private async runTurn(content: string): Promise<string> {
    if (!this.handle) await this.start();
    await this.adapter.sendInput(this.handle!, { type: 'user', content });
    let reply = '';
    for await (const ev of this.adapter.readOutput(this.handle!)) {
      if (ev.type === 'error') return `⚠ ${ev.content ?? 'runtime error'}`;
      if (ev.type === 'done') reply = ev.content ?? reply;
    }
    return reply.trim();
  }

  async stop(): Promise<void> {
    if (this.handle) {
      await this.adapter.stopAgent(this.handle);
      this.handle = undefined;
    }
  }
}
