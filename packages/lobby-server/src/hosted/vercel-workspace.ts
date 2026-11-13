// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { APIError, Sandbox, type SandboxRegion } from '@vercel/sandbox';
import type { WorkspaceAdapter, WorkspaceProfile } from '@agent-os/protocol-core';
import { createShellWorkspace } from './shell-workspace.js';
import { WorkspaceAllocationRecovery } from './workspace-allocation.js';

export function configuredVercelWorkspaces(env: NodeJS.ProcessEnv = process.env): WorkspaceAdapter[] {
  if (!env.AGENT_OS_VERCEL_SANDBOX_PROFILE) return [];
  const { region, cpu, diskMiB, maxRuntimeMs, maxMicrosPerSecond, command } =
    JSON.parse(env.AGENT_OS_VERCEL_SANDBOX_PROFILE) ?? {};
  if (typeof region !== 'string' || !/^[a-z]{3}\d$/.test(region) || typeof command !== 'string' || !command.trim() ||
      ![cpu, diskMiB, maxRuntimeMs, maxMicrosPerSecond].every(n => Number.isSafeInteger(n) && n > 0) ||
      maxRuntimeMs > 18_000_000 || Math.ceil(maxRuntimeMs / 1000) * maxMicrosPerSecond > 1_000_000_000) {
    throw new Error('Invalid AGENT_OS_VERCEL_SANDBOX_PROFILE.');
  }
  return [createVercelWorkspace({ command, maxMicrosPerSecond, profile: {
    id: 'microvm', isolation: 'microvm', regions: [region], cpu, diskMiB,
    memoryMiB: cpu * 2048, maxRuntimeMs, egress: 'none',
  } }, Sandbox, env)];
}

export function createVercelWorkspace(config: {
  command: string;
  maxMicrosPerSecond: number;
  profile: WorkspaceProfile;
}, sdk = Sandbox, env: NodeJS.ProcessEnv = process.env): WorkspaceAdapter {
  function credentials(credential: string) {
    const [teamId, projectId, mode, secret, ...extra] = credential.split(':');
    if (!/^team_[\w-]+$/.test(teamId) || !/^prj_[\w-]+$/.test(projectId ?? '') || extra.length) {
      throw new Error('Enter the Vercel Sandbox team and project IDs.');
    }
    if (mode === 'token' && secret?.trim()) return { teamId, projectId, token: secret };
    if (mode === 'oidc' && !secret && teamId === env.VERCEL_TEAM_ID && projectId === env.VERCEL_PROJECT_ID && env.VERCEL_OIDC_TOKEN) {
      return { teamId, projectId, token: env.VERCEL_OIDC_TOKEN };
    }
    throw new Error('Provide an approved Sandbox token or configure OIDC for this project.');
  }
  async function find(name: string, credential: string, signal: AbortSignal): Promise<Sandbox | undefined> {
    try { return await sdk.get({ ...credentials(credential), name, resume: false, signal }); }
    catch (error) { if (error instanceof APIError && error.response.status === 404) return undefined; throw error; }
  }
  const terminal = (status: string) => ['stopped', 'failed', 'aborted'].includes(status);
  const adapter = createShellWorkspace(
    { provider: 'vercel-sandbox', profiles: [config.profile], deletion: 'confirmed', credentials: 'control-plane-only', usage: 'final-or-pending' },
    config,
    async (id, credential, signal) => {
      const sandbox = await find(id, credential, signal);
      if (!sandbox) throw new Error('Vercel Sandbox workspace is unavailable.');
      if (sandbox.persistent !== false || sandbox.networkPolicy !== 'deny-all' || sandbox.region !== config.profile.regions[0]) {
        throw new Error('Vercel Sandbox did not confirm the approved disposable workspace profile.');
      }
      return {
        upload: (content, signal) => sandbox.writeFiles([{ path: '/tmp/agent-os-source.tar.gz', content }], { signal }),
        run: async (command, options) => {
          const process = await sandbox.runCommand('sh', ['-c', command], { signal: options.signal, timeoutMs: options.timeoutMs });
          if (process.exitCode !== 0) throw new Error('Vercel Sandbox workspace helper command failed.');
          return options.retainOutput === false ? undefined : { stdout: await process.stdout({ signal: options.signal }) };
        },
        read: async (path, signal) => {
          const process = await sandbox.runCommand('head', ['-c', '65536', '--', path], { signal, timeoutMs: 10_000 });
          if (process.exitCode !== 0) throw new Error('Vercel Sandbox workspace artifact is unavailable.');
          return process.stdout({ signal });
        },
      };
    },
    (key, credential, journal, attempt) => {
      const name = 'agent-os-' + key;
      return new WorkspaceAllocationRecovery(journal, {
        async create(signal) {
          const timeout = (attempt?.deadline ?? 0) - Date.now();
          if (timeout <= 0) throw new Error('Vercel Sandbox workspace deadline has elapsed.');
          const sandbox = await sdk.create({ ...credentials(credential), name, signal, timeout,
            runtime: 'python3.13', persistent: false, networkPolicy: 'deny-all', ports: [],
            region: attempt?.region as SandboxRegion, resources: { vcpus: config.profile.cpu } });
          return sandbox.name;
        },
        async find(signal) { return (await find(name, credential, signal))?.name; },
        async remove(id, signal) {
          const sandbox = await find(id, credential, signal);
          if (!sandbox) return { confirmed: true };
          if (sandbox.persistent !== false) return { confirmed: false };
          if (terminal(sandbox.status)) return { confirmed: true };
          await sandbox.stop({ signal });
          const stopped = await find(id, credential, signal);
          return { confirmed: !stopped || terminal(stopped.status) };
        },
        async confirmAbsent() { return false; },
      });
    },
  );
  adapter.verifyConnection = async (credential, signal) => {
    await sdk.list({ ...credentials(credential), signal, limit: 1 });
  };
  return adapter;
}
