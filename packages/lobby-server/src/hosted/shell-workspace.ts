// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import type { WorkspaceAdapter, WorkspaceCapabilities, WorkspaceAttempt, WorkspaceAllocationJournal } from '@agent-os/protocol-core';
import type { WorkspaceAllocationRecovery } from './workspace-allocation.js';

export type WorkspaceGuest = {
  upload(data: Uint8Array, signal: AbortSignal): Promise<void>;
  run(command: string, options: { signal: AbortSignal; timeoutMs: number; retainOutput?: boolean }): Promise<{ stdout?: string } | void>;
  read(path: string, signal: AbortSignal): Promise<string>;
};
const root = '/tmp/agent-os-workspace';

export function createShellWorkspace(
  capabilities: WorkspaceCapabilities,
  config: { command: string; maxMicrosPerSecond: number },
  connect: (id: string, credential: string, signal: AbortSignal) => Promise<WorkspaceGuest>,
  allocation: (key: string, credential: string, journal: WorkspaceAllocationJournal, attempt?: WorkspaceAttempt) => WorkspaceAllocationRecovery,
): WorkspaceAdapter {
  return {
    capabilities,
    estimate: attempt => Math.ceil((attempt.deadline - Date.now()) / 1000) * config.maxMicrosPerSecond,
    async provision(key, attempt, credential, signal, journal, source) {
      if (!source) throw new Error('Workspace source is unavailable.');
      const archive = await source();
      const id = await allocation(key, credential, journal, attempt).provision(signal);
      const guest = await connect(id, credential, signal);
      await guest.upload(archive, signal);
      await guest.run('if [ ! -f ' + root + '/baseline ]; then mkdir -p ' + root + '/source && tar --no-same-owner --no-same-permissions -xzf /tmp/agent-os-source.tar.gz --strip-components=1 -C ' + root + '/source' +
        ' && cd ' + root + '/source && git init -q --template= && git add --force --all && git -c user.name=AgentOS -c user.email=workspace@localhost commit --allow-empty -qm source' +
        ' && git rev-parse HEAD > ' + root + '/baseline.tmp && mv ' + root + '/baseline.tmp ' + root + '/baseline; fi',
        { signal, timeoutMs: Math.max(1, attempt.deadline - Date.now()), retainOutput: false });
    },
    async wait(_key, credential, signal, journal) {
      const id = journal.read().providerId;
      if (!id) throw new Error('Workspace allocation is unavailable.');
      const guest = await connect(id, credential, signal);
      const command = "'" + config.command.replaceAll("'", "'\\''") + "'";
      const remaining = journal.deadline === undefined ? undefined : journal.deadline - Date.now();
      if (remaining !== undefined && remaining < 1000) throw new Error('Workspace deadline has elapsed.');
      const execute = remaining === undefined ? 'sh -c ' : 'timeout --kill-after=1s ' + Math.floor(remaining / 1000) + 's sh -c ';
      await guest.run(
        'if mkdir ' + root + '/started 2>/dev/null; then ' +
        'cd ' + root + '/source && { ' + execute + command + ' 2>&1; echo $? > ' + root + '/exit.tmp; }' +
        ' | { head -c 65536 > ' + root + '/logs; cat > /dev/null; }; mv ' + root + '/exit.tmp ' + root + '/exit; ' +
        'fi; while [ ! -f ' + root + '/exit ]; do sleep 1; done',
        { signal, timeoutMs: 0, retainOutput: false },
      );
    },
    async collect(_key, credential, signal, journal) {
      const id = journal.read().providerId;
      if (!id) throw new Error('Workspace allocation is unavailable.');
      const guest = await connect(id, credential, signal);
      const status = (await guest.read(root + '/exit', signal)).trim();
      if (!/^\d{1,3}$/.test(status)) throw new Error('Workspace command exit status is unavailable.');
      const diff = await guest.run('cd ' + root + '/source && git add --all && bash -o pipefail -c ' +
        '\'git diff --cached --binary --no-ext-diff --no-textconv "$(cat ' + root + '/baseline)" -- | { head -c 262145; cat >/dev/null; }\'',
        { signal, timeoutMs: 10_000 }) as { stdout?: string };
      const patch = diff.stdout;
      const oversized = patch !== undefined && Buffer.byteLength(patch) > 262_144;
      return { exitCode: Number(status), logs: await guest.read(root + '/logs', signal),
        ...(oversized ? { patchUnavailable: 'size_limit' } : { patch: patch || undefined }) };
    },
    async destroy(key, credential, signal, journal) {
      return allocation(key, credential, journal).destroy(signal);
    },
  };
}
