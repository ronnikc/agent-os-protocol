// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import type { WorkspaceAllocationJournal } from '@agent-os/protocol-core';
import { WorkspaceAllocationRecovery } from './workspace-allocation.js';

const api = 'https://api.e2b.app';

/** E2B control plane for a fixed, operator-qualified template. */
export function e2bAllocation(
  key: string,
  credential: string,
  journal: WorkspaceAllocationJournal,
  settings: { templateId: string; cpu: number; deadline: number },
  fetchFn: typeof fetch = fetch,
) {
  const request = (path: string, method: string, signal: AbortSignal, body?: unknown) =>
    fetchFn(api + path, {
      method, signal, redirect: 'error',
      headers: { 'X-API-Key': credential, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return new WorkspaceAllocationRecovery(journal, {
    async create(signal) {
      const timeout = Math.floor((settings.deadline - Date.now()) / 1000);
      if (timeout < 1) throw new Error('Workspace deadline has elapsed.');
      const result = await request('/sandboxes', 'POST', signal, {
        templateID: settings.templateId, cpuCount: settings.cpu, timeout,
        autoPause: false, allow_internet_access: false,
        network: { allowPublicTraffic: false, dnsServers: [] },
        metadata: { agent_os_attempt: key },
      });
      if (result.status !== 201) {
        await result.body?.cancel();
        throw new Error('E2B did not confirm workspace creation.');
      }
      const record = await result.json() as { sandboxID?: string };
      if (!record.sandboxID) throw new Error('E2B did not return a workspace ID.');
      return record.sandboxID;
    },
    async find(signal) {
      const query = new URLSearchParams({ metadata: 'agent_os_attempt=' + key, limit: '2' });
      const result = await request('/v2/sandboxes?' + query, 'GET', signal);
      if (!result.ok) {
        await result.body?.cancel();
        throw new Error('E2B workspace lookup failed.');
      }
      const records = await result.json() as { sandboxID: string; metadata?: Record<string, string> }[];
      const matches = records.filter(record => record.metadata?.agent_os_attempt === key);
      if (matches.length > 1) throw new Error('E2B returned multiple workspaces for the same attempt.');
      return matches[0]?.sandboxID;
    },
    async remove(id, signal) {
      const result = await request('/sandboxes/' + encodeURIComponent(id), 'DELETE', signal);
      await result.body?.cancel();
      return { confirmed: result.status === 204 || result.status === 404 };
    },
    // A missing record after a timed-out create cannot prove the create settled.
    async confirmAbsent() { return false; },
  });
}
