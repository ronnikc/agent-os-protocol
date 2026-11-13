// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import type { WorkspaceAllocationJournal } from '@agent-os/protocol-core';

interface AllocationOperations {
  /** Find the provider resource by the unique, attempt-scoped identity. */
  find(signal: AbortSignal): Promise<string | undefined>;
  create(signal: AbortSignal): Promise<string>;
  /** Delete the resource and confirm that it is no longer billable. */
  remove(providerId: string, signal: AbortSignal): Promise<{ confirmed: boolean; actual?: number }>;
  /** Prove an unacknowledged create cannot still materialize. */
  confirmAbsent(signal: AbortSignal): Promise<boolean>;
}

export class WorkspaceAllocationRecovery {
  constructor(
    private readonly journal: WorkspaceAllocationJournal,
    private readonly operations: AllocationOperations,
  ) {}

  async provision(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const existing = this.journal.read();
    if (existing.providerId) return existing.providerId;
    // After a crash or uncertain response, retry discovery only. The journal
    // deliberately gives up a create if the process dies before sending it.
    const id = this.journal.beginCreate()
      ? await this.operations.create(signal)
      : await this.operations.find(signal);
    if (!id) throw new Error('Workspace creation has not been confirmed.');
    this.journal.bind(id);
    return id;
  }

  async destroy(signal: AbortSignal): Promise<{ confirmed: boolean; actual?: number }> {
    signal.throwIfAborted();
    const allocation = this.journal.read();
    if (allocation.createRequestedAt === undefined) return { confirmed: true, actual: 0 };
    const id = allocation.providerId ?? await this.operations.find(signal);
    if (!id) return { confirmed: await this.operations.confirmAbsent(signal) };
    this.journal.bind(id);
    return this.operations.remove(id, signal);
  }
}
