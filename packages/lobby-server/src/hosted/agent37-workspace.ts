// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import type { WorkspaceAdapter, WorkspaceProfile } from '@agent-os/protocol-core';
import { agent37Allocation } from './agent37-allocation.js';
import { createShellWorkspace, type WorkspaceGuest } from './shell-workspace.js';

export function configuredAgent37Workspaces(env: NodeJS.ProcessEnv = process.env): WorkspaceAdapter[] {
  if (!env.AGENT_OS_AGENT37_PROFILE) return [];
  const input = JSON.parse(env.AGENT_OS_AGENT37_PROFILE);
  const { template, type, region, cpu, memory, disk, maxRuntimeMs, maxMicrosPerSecond, command } = input ?? {};
  if (typeof template !== 'string' || !template.trim() || typeof command !== 'string' || !command.trim() ||
      !['default', 'vm'].includes(type) || typeof region !== 'string' || !/^[a-z0-9-]+$/.test(region) ||
      ![cpu, memory, disk, maxRuntimeMs, maxMicrosPerSecond].every(n => Number.isSafeInteger(n) && n > 0) ||
      maxRuntimeMs > 86_400_000 || Math.ceil(maxRuntimeMs / 1000) * maxMicrosPerSecond > 1_000_000_000) {
    throw new Error('Invalid AGENT_OS_AGENT37_PROFILE.');
  }
  return [createAgent37Workspace({ template, command, maxMicrosPerSecond,
    profile: { id: type, cpu, memoryMiB: memory * 1024, diskMiB: disk * 1024,
      isolation: type === 'vm' ? 'vm' : 'container', egress: 'none', regions: [region], maxRuntimeMs },
  })];
}

export function createAgent37Workspace(config: {
  template: string;
  profile: WorkspaceProfile;
  command: string;
  maxMicrosPerSecond: number;
}, fetchFn: typeof fetch = fetch): WorkspaceAdapter {
  const { profile } = config;
  const settings = {
    template: config.template,
    type: profile.isolation === 'vm' ? 'vm' as const : 'default' as const,
    region: profile.regions[0],
    resources: { cpu: profile.cpu, memory: profile.memoryMiB / 1024, disk: profile.diskMiB / 1024 },
  };
  return createShellWorkspace(
    { provider: 'agent37', profiles: [profile], deletion: 'confirmed', credentials: 'control-plane-only', usage: 'final-or-pending' },
    config,
    async (id, credential): Promise<WorkspaceGuest> => {
      const base = 'https://' + id + '.agent37.app/v1/files/content?path=';
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid Agent37 instance ID.');
      const headers = { 'X-Agent37-Key': credential };
      async function check(response: Response) {
        if (response.ok) return response;
        await response.body?.cancel();
        throw new Error('Agent37 workspace operation failed.');
      }
      return {
        async upload(bytes, signal) {
          // Reconfirm policy on recovered allocations as well as new ones. A
          // propagation response is retried by the provisioning sweep.
          const policy = await check(await fetchFn('https://api.agent37.com/v1/instances/' + id, {
            method: 'PATCH', headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' },
            body: JSON.stringify({ network: 'deny-all' }), signal, redirect: 'error',
          }));
          await policy.body?.cancel();
          const response = await check(await fetchFn(base + encodeURIComponent('/tmp/agent-os-source.tar.gz'), {
            method: 'PUT', body: Buffer.from(bytes), headers, signal, redirect: 'error',
          }));
          await response.body?.cancel();
        },
        async run(command, options) {
          const signal = options.timeoutMs > 0
            ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]) : options.signal;
          const response = await check(await fetchFn('https://sandbox.agent37.app/v1/instances/' + id + '/exec', {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
            signal, redirect: 'error', body: JSON.stringify({ command }),
          }));
          const result = await response.json() as { exit_code: number; stdout?: string; truncated?: boolean };
          if (result.exit_code !== 0 || result.truncated) throw new Error('Agent37 workspace helper command failed.');
          return options.retainOutput === false ? undefined : { stdout: result.stdout };
        },
        async read(path, signal) {
          const response = await check(await fetchFn(base + encodeURIComponent(path), { headers, signal, redirect: 'error' }));
          if (!response.body) throw new Error('Agent37 returned an empty artifact.');
          const reader = response.body.getReader();
          let size = 0;
          const chunks: Uint8Array[] = [];
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) return Buffer.concat(chunks, size).toString('utf8');
              size += value.byteLength;
              if (size > 65_536) throw new Error('Agent37 artifact exceeds the configured limit.');
              chunks.push(value);
            }
          } finally {
            await reader.cancel();
            reader.releaseLock();
          }
        },
      };
    },
    (key, credential, journal) => agent37Allocation(key, credential, journal, settings, fetchFn),
  );
}
