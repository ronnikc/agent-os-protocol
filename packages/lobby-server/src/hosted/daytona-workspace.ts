// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { Daytona, DaytonaNotFoundError } from '@daytona/sdk';
import type { WorkspaceAdapter, WorkspaceProfile } from '@agent-os/protocol-core';
import { createShellWorkspace } from './shell-workspace.js';
import { WorkspaceAllocationRecovery } from './workspace-allocation.js';

export function configuredDaytonaWorkspaces(env: NodeJS.ProcessEnv = process.env): WorkspaceAdapter[] {
  if (!env.AGENT_OS_DAYTONA_PROFILE) return [];
  const { snapshot, region, isolation, cpu, memoryMiB, diskMiB, maxRuntimeMs, maxMicrosPerSecond, command } =
    JSON.parse(env.AGENT_OS_DAYTONA_PROFILE) ?? {};
  if (typeof snapshot !== 'string' || !snapshot.trim() || typeof command !== 'string' || !command.trim() ||
      typeof region !== 'string' || !region.trim() || (isolation !== 'vm' && isolation !== 'container') ||
      ![cpu, memoryMiB, diskMiB, maxRuntimeMs, maxMicrosPerSecond].every(n => Number.isSafeInteger(n) && n > 0) ||
      maxRuntimeMs < 120_000 || maxRuntimeMs > 86_400_000 || Math.ceil(maxRuntimeMs / 1000) * maxMicrosPerSecond > 1_000_000_000) {
    throw new Error('Invalid AGENT_OS_DAYTONA_PROFILE.');
  }
  return [createDaytonaWorkspace({ snapshot, command, maxMicrosPerSecond, profile: {
    id: isolation, isolation, regions: [region], cpu, memoryMiB, diskMiB, maxRuntimeMs, egress: 'none',
  } })];
}

export function createDaytonaWorkspace(config: {
  snapshot: string;
  profile: WorkspaceProfile;
  command: string;
  maxMicrosPerSecond: number;
}, client: (apiKey: string) => Pick<Daytona, 'get' | 'create' | 'delete' | 'list'> =
  apiKey => new Daytona({ apiKey, apiUrl: 'https://app.daytona.io/api' })): WorkspaceAdapter {
  const profile = config.profile;
  const target = profile.regions[0];
  const expectedClass = profile.isolation === 'vm' ? 'linux-vm' : 'container';
  const find = async (daytona: ReturnType<typeof client>, id: string) => {
    try { return await daytona.get(id); }
    catch (error) {
      if (error instanceof DaytonaNotFoundError) return undefined;
      throw error;
    }
  };
  const adapter = createShellWorkspace(
    { provider: 'daytona', profiles: [profile], deletion: 'confirmed', credentials: 'control-plane-only', usage: 'final-or-pending' },
    config,
    async (id, credential, signal) => {
      signal.throwIfAborted();
      const sandbox = await client(credential).get(id);
      if (sandbox.networkBlockAll !== true || sandbox.public !== false || sandbox.sandboxClass !== expectedClass ||
          sandbox.target !== target || sandbox.cpu !== profile.cpu || sandbox.memory * 1024 !== profile.memoryMiB ||
          sandbox.disk * 1024 !== profile.diskMiB) {
        throw new Error('Daytona did not confirm the approved private workspace profile.');
      }
      signal.throwIfAborted();
      return {
        async upload(bytes, abort) {
          abort.throwIfAborted();
          await sandbox.fs.uploadFile(Buffer.from(bytes), '/tmp/agent-os-source.tar.gz', 30);
          abort.throwIfAborted();
        },
        async run(command, options) {
          options.signal.throwIfAborted();
          const result = await sandbox.process.executeCommand(command, undefined, undefined,
            Math.max(1, Math.ceil((options.timeoutMs || profile.maxRuntimeMs) / 1000)));
          options.signal.throwIfAborted();
          if (result.exitCode !== 0) throw new Error('Daytona workspace helper command failed.');
          return options.retainOutput === false ? undefined : { stdout: result.result };
        },
        async read(path, abort) {
          abort.throwIfAborted();
          const result = await sandbox.process.executeCommand('head -c 65536 -- ' + "'" + path.replaceAll("'", "'\\''") + "'", undefined, undefined, 10);
          abort.throwIfAborted();
          if (result.exitCode !== 0) throw new Error('Daytona workspace artifact is unavailable.');
          return result.result;
        },
      };
    },
    (key, credential, journal, attempt) => {
      const daytona = client(credential);
      const name = 'agent-os-' + key;
      return new WorkspaceAllocationRecovery(journal, {
        async create(signal) {
          signal.throwIfAborted();
          const remaining = (attempt?.deadline ?? 0) - Date.now();
          if (remaining < 60_000) throw new Error('Daytona requires at least one minute of workspace runtime.');
          const sandbox = await daytona.create({
            name, target, snapshot: config.snapshot, networkBlockAll: true, public: false,
            ephemeral: true, ttlMinutes: Math.floor(remaining / 60_000),
            labels: { agent_os_attempt: key },
          }, { timeout: Math.max(1, Math.min(30, Math.floor(remaining / 1000))) });
          return sandbox.id;
        },
        async find(signal) {
          signal.throwIfAborted();
          const sandbox = await find(daytona, name);
          return sandbox?.labels?.agent_os_attempt === key ? sandbox.id : undefined;
        },
        async remove(id, signal) {
          signal.throwIfAborted();
          const sandbox = await find(daytona, id);
          if (!sandbox) return { confirmed: true };
          try { await daytona.delete(sandbox, 20, true); }
          catch (error) { if (!(error instanceof DaytonaNotFoundError)) throw error; }
          return { confirmed: !(await find(daytona, id)) };
        },
        async confirmAbsent() { return false; },
      });
    },
  );
  adapter.verifyConnection = async (credential, signal) => {
    signal.throwIfAborted();
    const sandboxes = client(credential).list();
    try {
      await sandboxes.next();
      signal.throwIfAborted();
    } finally {
      await sandboxes.return?.();
    }
  };
  return adapter;
}
