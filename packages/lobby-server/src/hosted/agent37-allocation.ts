// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import type { WorkspaceAllocationJournal } from '@agent-os/protocol-core';
import { WorkspaceAllocationRecovery } from './workspace-allocation.js';

interface Instance {
  id: string;
  metadata?: Record<string, string>;
}

export function agent37Allocation(key: string, credential: string, journal: WorkspaceAllocationJournal, settings: {
  template: string;
  type: 'default' | 'vm';
  region: string;
  resources: { cpu: number; memory: number; disk: number };
}, fetchFn: typeof fetch = fetch) {
  const request = (path: string, method: string, signal: AbortSignal, body?: unknown) =>
    fetchFn('https://api.agent37.com/v1/instances' + path, {
      method, signal, redirect: 'error',
      headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return new WorkspaceAllocationRecovery(journal, {
    async create(signal) {
      const response = await request('', 'POST', signal, {
        ...settings,
        network: 'deny-all',
        public_ports: [],
        metadata: { agent_os_attempt: key },
      });
      if (response.status !== 201) {
        await response.body?.cancel();
        throw new Error('Agent37 did not confirm workspace creation.');
      }
      const { id } = await response.json() as Instance;
      if (!id) throw new Error('Agent37 did not return an instance ID.');
      return id;
    },
    async find(signal) {
      const response = await request('', 'GET', signal);
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Agent37 workspace lookup failed.');
      }
      const { data } = await response.json() as { data: Instance[] };
      const matches = data.filter(instance => instance.metadata?.agent_os_attempt === key);
      if (matches.length > 1) throw new Error('Agent37 returned multiple instances for the same attempt.');
      return matches[0]?.id;
    },
    async remove(id, signal) {
      const path = '/' + encodeURIComponent(id);
      const removed = await request(path, 'DELETE', signal);
      await removed.body?.cancel();
      if (!removed.ok && removed.status !== 404) return { confirmed: false };
      const checked = await request(path, 'GET', signal);
      await checked.body?.cancel();
      return { confirmed: checked.status === 404 };
    },
    async confirmAbsent() { return false; },
  });
}
