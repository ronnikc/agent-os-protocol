// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { ModalClient, NotFoundError, type Sandbox } from 'modal';
import type { WorkspaceAdapter, WorkspaceProfile } from '@agent-os/protocol-core';
import { createShellWorkspace } from './shell-workspace.js';
import { WorkspaceAllocationRecovery } from './workspace-allocation.js';

export function configuredModalWorkspaces(env: NodeJS.ProcessEnv = process.env): WorkspaceAdapter[] {
  if (!env.AGENT_OS_MODAL_PROFILE) return [];
  const { app, image, environment, region, isolation, cpu, memoryMiB, diskMiB, maxRuntimeMs, maxMicrosPerSecond, command } =
    JSON.parse(env.AGENT_OS_MODAL_PROFILE) ?? {};
  if (![app, image, environment, region, command].every(value => typeof value === 'string' && value.trim()) ||
      (isolation !== 'vm' && isolation !== 'container') ||
      ![cpu, memoryMiB, diskMiB, maxRuntimeMs, maxMicrosPerSecond].every(n => Number.isSafeInteger(n) && n > 0) ||
      maxRuntimeMs > 86_400_000 || Math.ceil(maxRuntimeMs / 1000) * maxMicrosPerSecond > 1_000_000_000) {
    throw new Error('Invalid AGENT_OS_MODAL_PROFILE.');
  }
  return [createModalWorkspace({ app, image, environment, command, maxMicrosPerSecond, profile: {
    id: isolation, isolation, regions: [region], cpu, memoryMiB, diskMiB, maxRuntimeMs, egress: 'none',
  } })];
}

export function createModalWorkspace(config: {
  app: string;
  image: string;
  environment: string;
  profile: WorkspaceProfile;
  command: string;
  maxMicrosPerSecond: number;
}, connect = (tokenId: string, tokenSecret: string) => new ModalClient({ tokenId, tokenSecret })): WorkspaceAdapter {
  const profile = config.profile;
  async function use<T>(credential: string, signal: AbortSignal, work: (client: ModalClient) => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const separator = credential.indexOf(':');
    if (separator < 1 || separator === credential.length - 1) throw new Error('Enter a Modal token ID and secret separated by a colon.');
    const client = connect(credential.slice(0, separator), credential.slice(separator + 1));
    const abort = () => client.close();
    signal.addEventListener('abort', abort, { once: true });
    try {
      const result = await work(client);
      signal.throwIfAborted();
      return result;
    } finally {
      signal.removeEventListener('abort', abort);
      client.close();
    }
  }
  async function lookup(get: () => Promise<Sandbox>): Promise<Sandbox | undefined> {
    try { return await get(); }
    catch (error) { if (error instanceof NotFoundError) return undefined; throw error; }
  }
  const adapter = createShellWorkspace(
    { provider: 'modal', profiles: [profile], deletion: 'confirmed', credentials: 'control-plane-only', usage: 'final-or-pending' },
    config,
    async (id, credential) => ({
      upload: (bytes, signal) => use(credential, signal, async client => {
        const sandbox = await client.sandboxes.fromId(id);
        await sandbox.filesystem.writeBytes(bytes, '/tmp/agent-os-source.tar.gz');
      }),
      run: (command, options) => use(credential, options.signal, async client => {
        const sandbox = await client.sandboxes.fromId(id);
        const process = await sandbox.exec(['sh', '-c', command], { timeoutMs: options.timeoutMs || profile.maxRuntimeMs });
        const [stdout, status] = await Promise.all([process.stdout.readText(), process.wait()]);
        if (status !== 0) throw new Error('Modal workspace helper command failed.');
        return options.retainOutput === false ? undefined : { stdout };
      }),
      read: (path, signal) => use(credential, signal, async client => {
        const sandbox = await client.sandboxes.fromId(id);
        const process = await sandbox.exec(['head', '-c', '65536', '--', path], { timeoutMs: 10_000 });
        const [stdout, status] = await Promise.all([process.stdout.readText(), process.wait()]);
        if (status !== 0) throw new Error('Modal workspace artifact is unavailable.');
        return stdout;
      }),
    }),
    (key, credential, journal, attempt) => {
      const name = 'agent-os-' + key;
      return new WorkspaceAllocationRecovery(journal, {
        create: signal => use(credential, signal, async client => {
          const app = await client.apps.fromName(config.app, { environment: config.environment });
          const image = await client.images.fromName(config.image, { environment: config.environment });
          const remaining = (attempt?.deadline ?? 0) - Date.now();
          if (remaining <= 0) throw new Error('Modal workspace deadline has elapsed.');
          const sandbox = await client.sandboxes.create(app, image, {
            name, blockNetwork: true, timeoutMs: remaining, regions: [...profile.regions],
            runtime: profile.isolation === 'vm' ? 'vm' : 'gvisor',
            cpu: profile.cpu / 2, cpuLimit: profile.cpu / 2,
            memoryMiB: profile.memoryMiB, memoryLimitMiB: profile.memoryMiB,
          });
          return sandbox.sandboxId;
        }),
        find: signal => use(credential, signal, async client =>
          (await lookup(() => client.sandboxes.fromName(config.app, name, { environment: config.environment, includeTerminated: true })))?.sandboxId),
        remove: (id, signal) => use(credential, signal, async client => {
          const sandbox = await lookup(() => client.sandboxes.fromId(id));
          if (!sandbox) return { confirmed: true };
          await sandbox.terminate();
          await sandbox.wait();
          return { confirmed: true };
        }),
        async confirmAbsent() { return false; },
      });
    },
  );
  adapter.verifyConnection = (credential, signal) => use(credential, signal, async client => {
    await client.apps.fromName(config.app, { environment: config.environment });
  });
  return adapter;
}
