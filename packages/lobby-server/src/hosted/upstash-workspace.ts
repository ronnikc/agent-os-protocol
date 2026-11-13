// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { Box, BoxError, EphemeralBox, type BoxSize } from '@upstash/box';
import type { WorkspaceAdapter, WorkspaceProfile } from '@agent-os/protocol-core';
import { createShellWorkspace } from './shell-workspace.js';
import { WorkspaceAllocationRecovery } from './workspace-allocation.js';

export function configuredUpstashWorkspaces(env: NodeJS.ProcessEnv = process.env): WorkspaceAdapter[] {
  if (!env.AGENT_OS_UPSTASH_BOX_PROFILE) return [];
  const { size, region, cpu, memoryMiB, diskMiB, maxRuntimeMs, maxMicrosPerSecond, command } =
    JSON.parse(env.AGENT_OS_UPSTASH_BOX_PROFILE) ?? {};
  if (!['small', 'medium', 'large'].includes(size) || region !== 'provider-managed' ||
      typeof command !== 'string' || !command.trim() ||
      ![cpu, memoryMiB, diskMiB, maxRuntimeMs, maxMicrosPerSecond].every(n => Number.isSafeInteger(n) && n > 0) ||
      maxRuntimeMs > 259_200_000 || Math.ceil(maxRuntimeMs / 1000) * maxMicrosPerSecond > 1_000_000_000) {
    throw new Error('Invalid AGENT_OS_UPSTASH_BOX_PROFILE.');
  }
  return [createUpstashWorkspace({ size, command, maxMicrosPerSecond, profile: {
    id: size, isolation: 'container', regions: [region], cpu, memoryMiB, diskMiB, maxRuntimeMs, egress: 'none',
  } })];
}

export function createUpstashWorkspace(config: {
  size: BoxSize;
  command: string;
  maxMicrosPerSecond: number;
  profile: WorkspaceProfile;
}, sdk = { get: Box.get, list: Box.list, create: EphemeralBox.create, remove: EphemeralBox.delete }): WorkspaceAdapter {
  async function find(name: string, apiKey: string): Promise<Box | undefined> {
    try { return await sdk.get(name, { apiKey, timeout: 10_000 }); }
    catch (error) { if (error instanceof BoxError && error.statusCode === 404) return undefined; throw error; }
  }
  const adapter = createShellWorkspace(
    { provider: 'upstash-box', profiles: [config.profile], deletion: 'confirmed', credentials: 'control-plane-only', usage: 'final-or-pending' },
    config,
    async (id, apiKey, signal) => {
      signal.throwIfAborted();
      const box = await find(id, apiKey);
      if (!box) throw new Error('Upstash Box workspace is unavailable.');
      if (box.networkPolicy.mode !== 'deny-all' || box.size !== config.size) {
        throw new Error('Upstash Box did not confirm the approved private workspace profile.');
      }
      return {
        upload: async (bytes, signal) => {
          signal.throwIfAborted();
          await box.files.write({ path: '/tmp/agent-os-source.tar.gz', content: Buffer.from(bytes).toString('base64'), encoding: 'base64' });
        },
        run: async (command, options) => {
          options.signal.throwIfAborted();
          const run = await box.exec.command(command);
          options.signal.throwIfAborted();
          if (run.exitCode !== 0) throw new Error('Upstash Box workspace helper command failed.');
          return options.retainOutput === false ? undefined : { stdout: run.stdout };
        },
        read: (path, signal) => {
          signal.throwIfAborted();
          return box.files.read(path, { length: 65_536 });
        },
      };
    },
    (key, apiKey, journal, attempt) => {
      const name = 'agent-os-' + key;
      return new WorkspaceAllocationRecovery(journal, {
        async create(signal) {
          signal.throwIfAborted();
          const ttl = Math.floor(((attempt?.deadline ?? 0) - Date.now()) / 1000);
          if (ttl < 1) throw new Error('Upstash Box workspace deadline has elapsed.');
          const box = await sdk.create({ apiKey, name, size: config.size, runtime: 'python', ttl,
            networkPolicy: { mode: 'deny-all' }, timeout: 10_000 });
          return box.id;
        },
        async find(signal) {
          signal.throwIfAborted();
          return (await find(name, apiKey))?.id;
        },
        async remove(id, signal) {
          signal.throwIfAborted();
          try { await sdk.remove({ apiKey, boxIds: [id] }); }
          catch (error) { if (!(error instanceof BoxError && error.statusCode === 404)) throw error; }
          return { confirmed: !(await find(id, apiKey)) };
        },
        async confirmAbsent() { return false; },
      });
    },
  );
  adapter.verifyConnection = async (apiKey, signal) => {
    signal.throwIfAborted();
    await sdk.list({ apiKey });
    signal.throwIfAborted();
  };
  return adapter;
}
