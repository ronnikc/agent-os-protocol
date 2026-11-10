// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * Runtime adapter registry — the relay/lobby/panel use this to discover available runtimes.
 * Adapters are feature-flagged: a missing runtime is reported (not fatal), and one adapter's
 * failure never breaks the others.
 */

import type { AgentRuntimeAdapter, RuntimeId, RuntimeDetectionResult } from '@agent-os/protocol-core';
import { claudeCliAdapter } from './claude-cli.js';
import { codexCliAdapter } from './codex-cli.js';

export class AdapterRegistry {
  private adapters = new Map<RuntimeId, AgentRuntimeAdapter>();

  register(adapter: AgentRuntimeAdapter): this {
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  get(id: RuntimeId): AgentRuntimeAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): AgentRuntimeAdapter[] {
    return [...this.adapters.values()];
  }

  /** Detect every registered runtime; one adapter throwing never breaks the rest. */
  async detectAll(): Promise<Record<string, RuntimeDetectionResult>> {
    const out: Record<string, RuntimeDetectionResult> = {};
    for (const adapter of this.adapters.values()) {
      try {
        out[adapter.id] = await adapter.detect();
      } catch (err) {
        out[adapter.id] = { installed: false, message: `detect failed: ${(err as Error).message}` };
      }
    }
    return out;
  }
}

/** The default registry — Claude CLI and Codex CLI are registered first-class today. */
export const runtimeRegistry = new AdapterRegistry().register(claudeCliAdapter).register(codexCliAdapter);
