// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import type { WorkspaceAllocation, WorkspaceArtifacts, WorkspaceAttempt, WorkspaceCleanup, WorkspaceState } from '@agent-os/protocol-core';
import type { IntegrationSecret, LobbyIntegration } from '../models.js';

export interface HostedPolicy {
  workspaceEnabled: boolean;
  periodHours: number;
  modelPerRun: number;
  modelPerPeriod: number;
  computePerRun: number;
  computePerPeriod: number;
  concurrency: number;
  deadlineMs: number;
}

export interface HostedConnection {
  integration: LobbyIntegration;
  secret?: IntegrationSecret;
  hint?: string;
}

export interface Usage {
  reserved: number;
  actual?: number;
}

export interface HostedRun {
  id: string;
  kind: 'model' | 'workspace';
  taskId?: string;
  attempt?: WorkspaceAttempt;
  allocation?: WorkspaceAllocation;
  state: WorkspaceState;
  cleanup: WorkspaceCleanup;
  started: number;
  deadline: number;
  usage: Usage[];
  artifacts?: WorkspaceArtifacts;
  failure?: string;
}

export interface HostedState {
  policy?: HostedPolicy;
  runs: HostedRun[];
  connections: HostedConnection[];
  audit: { at: number; actor: string; action: string; subject?: string }[];
}

export function emptyHostedState(): HostedState {
  return { runs: [], connections: [], audit: [] };
}

export function terminal(run: HostedRun): boolean {
  return run.state === 'succeeded' || run.state === 'failed' || run.state === 'cancelled';
}
