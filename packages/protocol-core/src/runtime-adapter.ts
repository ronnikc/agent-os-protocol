// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * Runtime adapter contract — the stable interface the relay/lobby use to drive any agent
 * runtime (CLI or API). Each runtime plugs in as a swappable adapter; the core never
 * hardwires to one runtime. See IMPLEMENTATION-PLAN.md §8 / charter §12.
 */

export type RuntimeId =
  | 'claude-cli'
  | 'codex-cli'
  | 'opencode'
  | 'cursor'
  | 'hermes'
  | 'openclaw'
  | 'api'
  | 'unknown';

export interface RuntimeDetectionResult {
  installed: boolean;
  version?: string;
  /** Resolved executable path, when known. */
  path?: string;
  /** Human-readable note (e.g. how to install when not detected). */
  message?: string;
}

export interface StartAgentConfig {
  /** Project root the agent operates in. */
  cwd: string;
  systemPrompt?: string;
  /** Instruction/governance files to load (e.g. CLAUDE.md, RULES.md). */
  instructionFiles?: string[];
  headless?: boolean;
  /** Resume a prior session, when the runtime supports it. */
  resumeSessionId?: string;
  /** Model override for this agent, when the runtime supports one (e.g. `--model`). */
  model?: string;
  env?: Record<string, string>;
}

export interface AgentProcessHandle {
  id: string;
  runtime: RuntimeId;
  pid?: number;
}

export interface RuntimeMessage {
  type: 'user' | 'system' | 'control';
  content: string;
}

export interface RuntimeEvent {
  type: 'output' | 'thinking' | 'tool_call' | 'status' | 'done' | 'error';
  content?: string;
  data?: unknown;
}

/** The contract every agent-runtime adapter implements. */
export interface AgentRuntimeAdapter {
  id: RuntimeId;
  label: string;
  detect(): Promise<RuntimeDetectionResult>;
  startAgent(config: StartAgentConfig): Promise<AgentProcessHandle>;
  stopAgent(handle: AgentProcessHandle): Promise<void>;
  sendInput(handle: AgentProcessHandle, message: RuntimeMessage): Promise<void>;
  readOutput(handle: AgentProcessHandle): AsyncIterable<RuntimeEvent>;
  supportsInteractiveMode: boolean;
  supportsHeadlessMode: boolean;
  supportsJsonOutput?: boolean;
  supportsSessionResume?: boolean;
  supportsMcp?: boolean;
}
