// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { Sandbox } from 'e2b';
import type { WorkspaceAdapter, WorkspaceProfile } from '@agent-os/protocol-core';
import { e2bAllocation } from './e2b-allocation.js';

interface E2bWorkspaceConfig {
  templateId: string;
  profile: WorkspaceProfile;
  /** Upper bound supplied by the deployment operator, in USD millionths/second. */
  maxMicrosPerSecond: number;
  /** Approved deployment command executed inside the guest. */
  command: string;
}

import { createShellWorkspace, type WorkspaceGuest } from './shell-workspace.js';

async function connectGuest(id: string, apiKey: string, signal: AbortSignal): Promise<WorkspaceGuest> {
  signal.throwIfAborted();
  const sandbox = await Sandbox.connect(id, { apiKey, requestTimeoutMs: 10_000, signal });
  signal.throwIfAborted();
  return {
    upload: (data, abort) => sandbox.files.write('/tmp/agent-os-source.tar.gz', new Blob([Buffer.from(data)]), { signal: abort }).then(() => {}),
    run: (command, options) => sandbox.commands.run(command, options),
    read: (path, abort) => sandbox.files.read(path, { signal: abort }),
  };
}



/** A deployment qualifies a template and cost bound before exposing its profile. */
export function configuredE2bWorkspace(env: NodeJS.ProcessEnv = process.env): WorkspaceAdapter[] {
  if (!env.AGENT_OS_E2B_PROFILE) return [];
  const value = JSON.parse(env.AGENT_OS_E2B_PROFILE) as Record<string, unknown>;
  const { templateId, region, cpu, memoryMiB, diskMiB, maxRuntimeMs, maxMicrosPerSecond, command } = value;
  const positive = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
  if (typeof templateId !== 'string' || !templateId.trim() || typeof region !== 'string' || !region.trim() ||
      typeof command !== 'string' || !command.trim() || !positive(cpu) || !positive(memoryMiB) ||
      !positive(diskMiB) || !positive(maxRuntimeMs) || !positive(maxMicrosPerSecond) || maxRuntimeMs < 1000 ||
      maxRuntimeMs > 86_400_000 || Math.ceil(maxRuntimeMs / 1000) * maxMicrosPerSecond > 1_000_000_000) {
    throw new Error('Invalid AGENT_OS_E2B_PROFILE.');
  }
  return [createE2bWorkspace({
    templateId, command, maxMicrosPerSecond,
    profile: { id: 'configured', regions: [region], cpu, memoryMiB, diskMiB, maxRuntimeMs, isolation: 'microvm', egress: 'none' },
  })];
}

export function createE2bWorkspace(
  config: E2bWorkspaceConfig,
  connect = connectGuest,
  fetchFn: typeof fetch = fetch,
): WorkspaceAdapter {
  const allocationSettings = { templateId: config.templateId, cpu: config.profile.cpu, deadline: 0 };
  return createShellWorkspace(
    { provider: 'e2b', profiles: [config.profile], deletion: 'confirmed', credentials: 'control-plane-only', usage: 'final-or-pending' },
    config, connect,
    (key, credential, journal, attempt) => e2bAllocation(key, credential, journal,
      { ...allocationSettings, deadline: attempt?.deadline ?? 0 }, fetchFn),
  );
}
