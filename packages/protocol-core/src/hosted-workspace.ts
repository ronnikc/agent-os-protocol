// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

export const workspaceProviders = ['e2b', 'agent37', 'daytona', 'modal', 'upstash-box', 'vercel-sandbox'] as const;
export type WorkspaceProvider = typeof workspaceProviders[number];

export interface WorkspaceProfile {
  id: string;
  cpu: number;
  memoryMiB: number;
  diskMiB: number;
  isolation: 'container' | 'microvm' | 'vm';
  egress: 'none' | 'allowlist' | 'unrestricted';
  regions: readonly string[];
  maxRuntimeMs: number;
}

export interface WorkspaceCapabilities {
  provider: WorkspaceProvider;
  profiles: readonly WorkspaceProfile[];
  deletion: 'confirmed';
  credentials: 'control-plane-only';
  usage: 'final-or-pending';
}

export interface WorkspaceAttempt {
  lobbyId: string;
  taskId: string;
  assignedAgentId?: string;
  attemptId: string;
  connectionId: string;
  sourceRevision: string;
  sourceRepository?: string;
  sourceIntegrationId?: string;
  profileId: string;
  region: string;
  deadline: number;
}

export type WorkspaceState = 'requested' | 'provisioning' | 'running' | 'collecting' | 'succeeded' | 'failed' | 'cancelled';
export type WorkspaceCleanup = 'pending' | 'confirmed';

export interface WorkspaceArtifacts {
  /** Exit status of the approved workspace command. */
  exitCode?: number;
  logs?: string;
  tests?: string;
  patch?: string;
  patchUnavailable?: 'size_limit' | 'credential_redacted';
  files?: readonly string[];
}

/** Persisted before a billable create and retained until teardown completes. */
export interface WorkspaceAllocation {
  createRequestedAt?: number;
  providerId?: string;
}

export interface WorkspaceAllocationJournal {
  readonly deadline?: number;
  read(): WorkspaceAllocation;
  /** Returns false when this attempt already issued its create request. */
  beginCreate(): boolean;
  bind(providerId: string): void;
}

/**
 * attemptKey is stable across processes. Provision must be idempotent. Destroy must
 * find even an unacknowledged allocation by key and fence future allocations with
 * that key before confirming deletion. Credentials authenticate the control plane
 * and must never be injected into the workspace. Usage is final only when billed
 * totals are known. Compute is denominated in USD millionths.
 */
export interface WorkspaceAdapter {
  capabilities: WorkspaceCapabilities;
  /** Check account access without provisioning a billable workspace. */
  verifyConnection?(credential: string, signal: AbortSignal): Promise<void>;
  estimate(attempt: WorkspaceAttempt): number;
  provision(attemptKey: string, attempt: WorkspaceAttempt, credential: string, signal: AbortSignal, allocation: WorkspaceAllocationJournal, source?: () => Promise<Uint8Array>): Promise<void>;
  wait(attemptKey: string, credential: string, signal: AbortSignal, allocation: WorkspaceAllocationJournal): Promise<void>;
  collect(attemptKey: string, credential: string, signal: AbortSignal, allocation: WorkspaceAllocationJournal): Promise<WorkspaceArtifacts>;
  destroy(attemptKey: string, credential: string, signal: AbortSignal, allocation: WorkspaceAllocationJournal): Promise<{ confirmed: boolean; actual?: number }>;
}
