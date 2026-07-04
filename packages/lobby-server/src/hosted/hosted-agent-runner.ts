// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

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
}

export class HostedAgentRunner {
  private handle?: AgentProcessHandle;
  private running = false;

  constructor(private readonly adapter: AgentRuntimeAdapter, private readonly opts: HostedAgentOptions = {}) {}

  /** Open the adapter session. Idempotent. */
  async start(): Promise<void> {
    if (this.handle) return;
    this.handle = await this.adapter.startAgent({ cwd: this.opts.cwd ?? '/hosted', systemPrompt: this.opts.systemPrompt });
  }

  /**
   * Run one turn for an inbound message and return the reply text ('' if none). Serialised: a
   * second call while a turn is in flight is skipped (returns '') so a burst of messages can't
   * interleave turns on the single session.
   */
  async respondTo(content: string): Promise<string> {
    if (!this.handle) await this.start();
    if (this.running) return '';
    this.running = true;
    try {
      await this.adapter.sendInput(this.handle!, { type: 'user', content });
      let reply = '';
      for await (const ev of this.adapter.readOutput(this.handle!)) {
        if (ev.type === 'error') return `⚠ ${ev.content ?? 'runtime error'}`;
        if (ev.type === 'done') reply = ev.content ?? reply;
      }
      return reply.trim();
    } finally {
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    if (this.handle) {
      await this.adapter.stopAgent(this.handle);
      this.handle = undefined;
    }
  }
}
