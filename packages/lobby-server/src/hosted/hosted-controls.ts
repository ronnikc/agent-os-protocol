// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { randomUUID } from 'node:crypto';
import { workspaceProviders, type WorkspaceAdapter, type WorkspaceAllocationJournal, type WorkspaceAttempt, type WorkspaceFileTools, type WorkspaceProvider } from '@agent-os/protocol-core';
import { hasConfiguredKey, keyHint, open, seal, sealedKeyId } from '../crypto/secret-box.js';
import type { LobbyStore } from '../store.js';
import { terminal, type HostedPolicy, type HostedRun, type HostedState } from './hosted-state.js';
import { workspaceAccountVerifier } from './workspace-account.js';

export class HostedControlError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export class WorkspaceTaskBusyError extends HostedControlError {}

function integer(value: unknown, max = 1_000_000_000): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function audit(state: HostedState, actor: string, action: string, subject?: string) {
  state.audit.push({ at: Date.now(), actor, action, subject });
}

function liability(run: HostedRun) {
  return run.usage.reduce((total, entry) => total + (entry.actual ?? entry.reserved), 0);
}

export class HostedControls {
  workspaceAgent?: (id: string, attempt: WorkspaceAttempt, tools: WorkspaceFileTools, signal: AbortSignal) => Promise<void>;
  workspaceAgentAvailable?: (lobbyId: string, agentId: string) => boolean;
  private readonly active = new Map<string, AbortController>();
  private readonly adapters: Map<WorkspaceProvider, WorkspaceAdapter>;
  private closed = false;

  constructor(
    private readonly store: LobbyStore,
    adapters: readonly WorkspaceAdapter[] = [],
    private readonly readSource?: (attempt: WorkspaceAttempt, signal: AbortSignal) => Promise<Uint8Array>,
  ) {
    this.adapters = new Map(adapters.map(adapter => [adapter.capabilities.provider, adapter]));
  }

  settings(lobbyId: string) {
    const state = this.store.readHostedState(lobbyId);
    return {
      policy: state.policy ?? null,
      providers: workspaceProviders.map(id => ({
        id,
        capabilities: this.adapters.get(id)?.capabilities ?? null,
        canVerify: Boolean(this.adapters.get(id)?.verifyConnection || workspaceAccountVerifier(id)),
        ...(id === 'vercel-sandbox' && /^team_[\w-]+$/.test(process.env.VERCEL_TEAM_ID ?? '') &&
          /^prj_[\w-]+$/.test(process.env.VERCEL_PROJECT_ID ?? '') ? {
            project: { teamId: process.env.VERCEL_TEAM_ID, projectId: process.env.VERCEL_PROJECT_ID },
          } : {}),
      })),
      connections: state.connections.filter(c => c.integration.status !== 'revoked')
        .map(({ integration, hint }) => ({ id: integration.id, provider: integration.provider, status: integration.status, hint })),
    };
  }

  history(lobbyId: string, offset: number, limit: number) {
    const { runs } = this.store.readHostedState(lobbyId);
    return { data: runs.slice().reverse().slice(offset, offset + limit), total: runs.length, offset, limit };
  }

  workspaceEvidence(lobbyId: string, runId: string) {
    const run = this.store.readHostedState(lobbyId).runs.find(entry => entry.id === runId && entry.kind === 'workspace');
    if (!run?.attempt) throw new HostedControlError('Workspace run not found.', 404);
    return { id: run.id, state: run.state, sourceRevision: run.attempt.sourceRevision, artifacts: run.artifacts };
  }

  workspaceTaskEvidence(lobbyId: string, taskId: string, agentId: string) {
    const run = this.store.readHostedState(lobbyId).runs.slice().reverse().find(entry =>
      entry.kind === 'workspace' && entry.taskId === taskId && entry.attempt?.assignedAgentId === agentId);
    if (!run?.attempt) return { status: 'unavailable' };
    return {
      id: run.id, state: run.state, cleanup: run.cleanup, sourceRevision: run.attempt.sourceRevision,
      exitCode: run.artifacts?.exitCode ?? null,
    };
  }

  latestWorkspaceByTask(lobbyId: string) {
    const latest = new Map<string, { id: string; state: HostedRun['state']; sourceRevision: string }>();
    for (const run of this.store.readHostedState(lobbyId).runs) {
      if (run.kind === 'workspace' && run.attempt) {
        latest.set(run.attempt.taskId, { id: run.id, state: run.state, sourceRevision: run.attempt.sourceRevision });
      }
    }
    return latest;
  }

  setPolicy(lobbyId: string, actor: string, input: Record<string, unknown>) {
    const { workspaceEnabled, periodHours, modelPerRun, modelPerPeriod, computePerRun, computePerPeriod, concurrency, deadlineMs } = input;
    if (typeof workspaceEnabled !== 'boolean' || !integer(periodHours, 744) || periodHours < 1 ||
        !integer(modelPerRun) || !integer(modelPerPeriod) || modelPerRun > modelPerPeriod ||
        !integer(computePerRun) || !integer(computePerPeriod) || computePerRun > computePerPeriod ||
        !integer(concurrency, 100) || concurrency < 1 || !integer(deadlineMs, 86_400_000) || deadlineMs < 1) {
      throw new HostedControlError('Check the budget period, ceilings, concurrency and deadline.', 400);
    }
    const policy: HostedPolicy = { workspaceEnabled, periodHours, modelPerRun, modelPerPeriod, computePerRun, computePerPeriod, concurrency, deadlineMs };
    const cancelled = this.store.mutateHostedState(lobbyId, state => {
      state.policy = policy;
      audit(state, actor, 'hosted_policy_updated');
      const runIds: string[] = [];
      if (!workspaceEnabled) {
        for (const run of state.runs) {
          if (run.kind !== 'workspace' || terminal(run)) continue;
          run.state = 'cancelled';
          audit(state, actor, 'hosted_run_cancelled', run.id);
          runIds.push(run.id);
        }
      }
      return runIds;
    });
    for (const id of cancelled) {
      this.active.get(id)?.abort();
      this.kick(lobbyId, id);
    }
    return policy;
  }

  async verifyVercelProject(credential: unknown) {
    if (typeof credential !== 'string' || !credential.trim() || credential.length > 8192) {
      throw new HostedControlError('Enter the Vercel Sandbox project and its credentials.', 400);
    }
    const adapter = this.adapters.get('vercel-sandbox');
    if (!adapter?.verifyConnection) throw new HostedControlError('Vercel Sandbox is unavailable on this deployment.');
    try { await adapter.verifyConnection(credential, AbortSignal.timeout(10_000)); }
    catch { throw new HostedControlError('Vercel denied access to this Sandbox project or could not be reached.', 400); }
  }

  connection(lobbyId: string, actor: string, provider: WorkspaceProvider, action: unknown, credential: unknown) {
    if (action !== 'connect' && action !== 'rotate' && action !== 'disable' && action !== 'disconnect') {
      throw new HostedControlError('Choose a provider connection action.', 400);
    }
    const updating = action === 'connect' || action === 'rotate';
    if (updating && (typeof credential !== 'string' || !credential.trim() || credential.length > 8192)) {
      throw new HostedControlError('Enter a provider credential.', 400);
    }
    if (updating && !hasConfiguredKey()) throw new HostedControlError('Configure the lobby secret encryption key first.');
    this.store.mutateHostedState(lobbyId, state => {
      const existing = state.connections.find(c => c.integration.provider === provider && c.integration.status !== 'revoked');
      if (action === 'connect' && existing) throw new HostedControlError('Rotate the existing provider connection.');
      if (action !== 'connect' && !existing) throw new HostedControlError('Provider connection not found.', 404);
      if (action !== 'disable' && existing && state.runs.some(run =>
        run.attempt?.connectionId === existing.integration.id && run.cleanup === 'pending')) {
        throw new HostedControlError('Confirm cleanup for affected workspaces before changing this credential.');
      }
      const now = new Date().toISOString();
      // Keep prior attempts tied to their original account. Unknown bills still
      // reserve budget after the account credential is removed.
      if (action === 'rotate' && existing) {
        existing.integration.status = 'revoked';
        existing.integration.updated_at = now;
        delete existing.secret;
        delete existing.hint;
      }
      const connection = (action === 'rotate' ? undefined : existing) ?? {
        integration: { id: randomUUID(), lobby_id: lobbyId, provider, status: 'pending' as const, scopes: [],
          installed_by_identity_ref: actor, created_at: now, updated_at: now },
      };
      if (connection !== existing) state.connections.push(connection);
      connection.integration.status = updating ? 'active' : action === 'disable' ? 'pending' : 'revoked';
      connection.integration.updated_at = now;
      if (updating && typeof credential === 'string') {
        const encrypted = seal(credential);
        connection.secret = { id: randomUUID(), integration_id: connection.integration.id, secret_type: 'access_token',
          encrypted_value: encrypted, encryption_key_id: sealedKeyId(encrypted), rotated_at: now };
        connection.hint = credential.length > 4 ? keyHint(credential) : '••••';
      }
      if (action === 'disconnect') {
        delete connection.secret;
        delete connection.hint;
      }
      audit(state, actor, 'workspace_provider_' + action, connection.integration.id);
    });
  }

  private policy(state: HostedState): HostedPolicy {
    if (!state.policy) throw new HostedControlError('Set hosted limits in Apps before starting hosted work.');
    return state.policy;
  }

  async verifyConnection(lobbyId: string, actor: string, provider: WorkspaceProvider) {
    const adapter = this.adapters.get(provider);
    const verify = adapter?.verifyConnection?.bind(adapter) ?? workspaceAccountVerifier(provider);
    if (!verify) throw new HostedControlError('Connection verification is unavailable for this provider.');
    const connection = this.store.readHostedState(lobbyId).connections.find(c =>
      c.integration.provider === provider && c.integration.status === 'active');
    const secret = connection?.secret;
    if (!secret) throw new HostedControlError('Active workspace connection not found.', 404);
    try {
      await verify(open(secret.encrypted_value), AbortSignal.timeout(10_000));
    } catch {
      throw new HostedControlError('Provider verification failed. Check the credential and account permissions, then retry.', 422);
    }
    this.store.mutateHostedState(lobbyId, state => {
      if (!state.connections.some(c => c.integration.id === connection.integration.id &&
          c.integration.status === 'active' && c.secret?.id === secret.id)) {
        throw new HostedControlError('The connection changed during verification. Retry with the current credential.');
      }
      audit(state, actor, 'workspace_provider_verified', connection.integration.id);
    });
  }

  private admit(state: HostedState, run: HostedRun, parentId?: string) {
    const policy = this.policy(state);
    if (this.closed) throw new HostedControlError('Hosted execution is shutting down.');
    if (state.runs.filter(r => r.id !== parentId && (!terminal(r) || r.cleanup === 'pending' ||
        (r.kind === 'model' && this.active.has(r.id)))).length >= policy.concurrency) {
      throw new HostedControlError('Hosted concurrency limit reached.');
    }
    state.runs.push(run);
  }

  private reserve(state: HostedState, run: HostedRun, amount: number) {
    const policy = this.policy(state);
    const model = run.kind === 'model';
    const runLimit = model ? policy.modelPerRun : policy.computePerRun;
    const periodLimit = model ? policy.modelPerPeriod : policy.computePerPeriod;
    const since = Date.now() - policy.periodHours * 3_600_000;
    const spent = state.runs.filter(r => r.kind === run.kind && (r.started >= since || !terminal(r) ||
      r.usage.some(u => u.actual === undefined))).reduce((total, r) => total + liability(r), 0);
    if (!integer(amount) || amount === 0 || liability(run) + amount > runLimit || spent + amount > periodLimit) {
      throw new HostedControlError('Hosted ' + (model ? 'model' : 'compute') + ' budget exhausted.');
    }
    run.usage.push({ reserved: amount });
    return run.usage.length - 1;
  }

  private checkMarketplaceSource(lobbyId: string, taskId: string, repository: string | undefined, revision: string) {
    const agreement = this.store.readMarketplaceState(lobbyId).agreements.find(entry => entry.assignmentId === taskId);
    if (!agreement) return;
    const approved = agreement.listing.workspaceSource;
    if (!approved || approved.repository.toLowerCase() !== repository?.toLowerCase() || approved.revision !== revision.toLowerCase() ||
        agreement.listing.deadline <= Date.now() || !['assigned', 'in_progress', 'revision_requested'].includes(agreement.delivery?.status ?? 'assigned')) {
      throw new HostedControlError('This agreement does not authorize staging that repository and commit.', 403);
    }
  }

  async requestWorkspace(lobbyId: string, actor: string, input: Record<string, unknown>) {
    const { taskId, attemptId, connectionId, sourceRevision, profileId, region } = input;
    if (typeof taskId !== 'string' || typeof attemptId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(attemptId) ||
        typeof connectionId !== 'string' || typeof sourceRevision !== 'string' || !/^[a-f0-9]{40}$/i.test(sourceRevision) ||
        typeof profileId !== 'string' || typeof region !== 'string') {
      throw new HostedControlError('Select a task, connection, profile, region and pinned commit.', 400);
    }
    const task = await this.store.getTask(lobbyId, taskId);
    if (!task) throw new HostedControlError('Lobby task not found.', 404);
    const sourceIntegration = this.readSource ? await this.store.getIntegration(lobbyId, 'github') : undefined;
    const sourceRepository = sourceIntegration?.repo_full_name;
    this.checkMarketplaceSource(lobbyId, taskId, sourceRepository, sourceRevision);
    const { run, created } = this.store.mutateHostedState(lobbyId, state => {
      const duplicate = state.runs.find(r => r.taskId === taskId && r.attempt?.attemptId === attemptId);
      if (duplicate) {
        const a = duplicate.attempt!;
        if (a.connectionId !== connectionId || a.sourceRevision !== sourceRevision || a.profileId !== profileId || a.region !== region) {
          throw new HostedControlError('This task attempt already has a different workspace request.');
        }
        return { run: duplicate, created: false };
      }
      if (!task.assigned_to?.trim()) throw new HostedControlError('Assign this task to an agent before launching a workspace.');
      if (task.status === 'completed' || task.status === 'cancelled') {
        throw new HostedControlError('Reopen this task before launching a workspace.');
      }
      const policy = this.policy(state);
      if (!policy.workspaceEnabled) throw new HostedControlError('Workspace execution is disabled.');
      if (state.runs.some(existing => existing.taskId === taskId && (!terminal(existing) || this.active.has(existing.id)))) {
        throw new HostedControlError('This task already has a hosted run in progress.');
      }
      const connection = state.connections.find(c => c.integration.id === connectionId && c.integration.status === 'active');
      if (!connection?.secret) throw new HostedControlError('Active workspace connection not found.', 404);
      const adapter = this.adapters.get(connection.integration.provider as WorkspaceProvider);
      if (!adapter) throw new HostedControlError('Workspace provider is unavailable.');
      if (task.output_mode === 'workspace' && (!this.workspaceAgent || !adapter.openFileTools)) {
        throw new HostedControlError('The selected workspace provider cannot run assigned agents.');
      }
      if (task.output_mode === 'workspace' && !this.workspaceAgentAvailable?.(lobbyId, task.assigned_to)) {
        throw new HostedControlError('Start the assigned hosted agent before launching its workspace.');
      }
      const profile = adapter.capabilities.profiles.find(p => p.id === profileId && p.regions.includes(region));
      if (!profile) throw new HostedControlError('Select an approved resource profile and region.', 400);
      const started = Date.now();
      const deadline = started + Math.min(policy.deadlineMs, profile.maxRuntimeMs);
      if (this.readSource && !sourceRepository) throw new HostedControlError('Select a GitHub repository in this lobby before launching a workspace.');
      const attempt: WorkspaceAttempt = { lobbyId, taskId, assignedAgentId: task.assigned_to, attemptId,
        connectionId, sourceRevision, sourceRepository, sourceIntegrationId: sourceIntegration?.id, profileId, region, deadline };
      const run: HostedRun = { id: randomUUID(), kind: 'workspace', taskId, attempt, state: 'requested', cleanup: 'pending', started, deadline, usage: [] };
      this.admit(state, run);
      this.reserve(state, run, adapter.estimate(attempt));
      audit(state, actor, 'workspace_requested', run.id);
      return { run, created: true };
    });
    if (created) this.kick(lobbyId, run.id);
    return run;
  }

  private change<T>(lobbyId: string, id: string, apply: (run: HostedRun, state: HostedState) => T): T {
    return this.store.mutateHostedState(lobbyId, state => {
      const run = state.runs.find(r => r.id === id);
      if (!run) throw new HostedControlError('Hosted run not found.', 404);
      return apply(run, state);
    });
  }

  cancel(lobbyId: string, id: string, actor: string) {
    const cancelled = this.change(lobbyId, id, (run, state) => {
      if (terminal(run)) return false;
      run.state = 'cancelled';
      audit(state, actor, 'hosted_run_cancelled', id);
      return true;
    });
    if (cancelled) this.active.get(id)?.abort();
    this.kick(lobbyId, id);
  }

  cancelTaskWorkspaces(lobbyId: string, taskId: string, actor: string) {
    for (const run of this.store.readHostedState(lobbyId).runs) {
      if (run.kind === 'workspace' && run.taskId === taskId && !terminal(run)) this.cancel(lobbyId, run.id, actor);
    }
  }

  cancelTaskExecution(lobbyId: string, taskId: string, actor: string) {
    for (const run of this.store.readHostedState(lobbyId).runs) {
      if (run.taskId === taskId && !terminal(run)) this.cancel(lobbyId, run.id, actor);
    }
  }

  async runModel<T>(lobbyId: string, taskId: string | undefined, work: (id: string, signal: AbortSignal) => Promise<T>,
    workspace?: { id: string; signal: AbortSignal }): Promise<T> {
    workspace?.signal.throwIfAborted();
    const run = this.store.mutateHostedState(lobbyId, state => {
      const policy = this.policy(state);
      const parent = workspace && state.runs.find(existing => existing.id === workspace.id && existing.kind === 'workspace' &&
        existing.taskId === taskId && existing.state === 'running');
      if (workspace && !parent) throw new HostedControlError('Workspace model session is no longer authorized.');
      if (!workspace && taskId && state.runs.some(existing => existing.kind === 'workspace' && existing.taskId === taskId &&
          (!terminal(existing) || this.active.has(existing.id)))) {
        throw new WorkspaceTaskBusyError('This task already has a workspace run in progress.');
      }
      const started = Date.now();
      const run: HostedRun = { id: randomUUID(), taskId, kind: 'model', state: 'running', cleanup: 'confirmed',
        started, deadline: started + policy.deadlineMs, usage: [] };
      this.admit(state, run, parent?.id);
      audit(state, 'hosted', 'model_run_started', run.id);
      return run;
    });
    const controller = new AbortController();
    this.active.set(run.id, controller);
    const signal = AbortSignal.any([controller.signal, workspace?.signal ?? controller.signal, AbortSignal.timeout(Math.max(1, run.deadline - Date.now()))]);
    try {
      const result = await work(run.id, signal);
      signal.throwIfAborted();
      if (typeof result === 'string' && result.startsWith('⚠')) this.finish(lobbyId, run.id, 'failed', result.slice(2, 250));
      else this.finish(lobbyId, run.id, 'succeeded');
      return result;
    } catch (error) {
      this.finish(lobbyId, run.id, 'failed', signal.aborted ? 'Model run stopped.' : 'Model run failed.');
      throw error;
    } finally {
      this.active.delete(run.id);
    }
  }

  reserveModel(lobbyId: string, id: string, amount: number) {
    return this.change(lobbyId, id, (run, state) => {
      if (run.kind !== 'model' || terminal(run) || run.deadline <= Date.now()) throw new HostedControlError('Model run has stopped.');
      return this.reserve(state, run, amount);
    });
  }

  reconcileModel(lobbyId: string, id: string, index: number, actual: number | undefined) {
    if (!integer(actual, Number.MAX_SAFE_INTEGER)) return;
    return this.change(lobbyId, id, (run, state) => {
      const usage = run.usage[index];
      if (run.kind !== 'model' || !usage) throw new Error('Invalid model reservation');
      if (usage.actual !== undefined) return usage.actual > usage.reserved;
      usage.actual = actual;
      audit(state, 'hosted', actual > usage.reserved ? 'model_reservation_exceeded' : 'model_usage_reconciled', id);
      return actual > usage.reserved;
    });
  }
  private finish(lobbyId: string, id: string, outcome: 'succeeded' | 'failed', failure?: string, artifacts?: HostedRun['artifacts']) {
    this.change(lobbyId, id, (run, state) => {
      if (terminal(run)) return;
      run.state = outcome;
      run.failure = failure;
      run.artifacts = artifacts;
      audit(state, 'hosted', 'hosted_run_' + outcome, id);
    });
  }

  private kick(lobbyId: string, id: string) {
    if (this.closed || this.active.has(id)) return;
    const run = this.store.readHostedState(lobbyId).runs.find(r => r.id === id);
    if (run?.kind !== 'workspace' || (run.cleanup === 'confirmed' && run.usage[0].actual !== undefined)) return;
    const controller = new AbortController();
    this.active.set(id, controller);
    void this.drive(lobbyId, run, controller.signal)
      .catch(() => { /* Durable state is retried by the recovery sweep. */ })
      .finally(() => this.active.delete(id));
  }

  private async drive(lobbyId: string, run: HostedRun, cancel: AbortSignal) {
    const attempt = run.attempt!;
    const connection = this.store.readHostedState(lobbyId).connections.find(c => c.integration.id === attempt.connectionId);
    const adapter = this.adapters.get(connection?.integration.provider as WorkspaceProvider);
    if (!adapter || !connection?.secret) return;
    const credential = open(connection.secret.encrypted_value);
    const signal = AbortSignal.any([cancel, AbortSignal.timeout(Math.max(1, run.deadline - Date.now()))]);
    const allocation: WorkspaceAllocationJournal = {
      deadline: run.deadline,
      read: () => this.store.readHostedState(lobbyId).runs.find(current => current.id === run.id)?.allocation ?? {},
      beginCreate: () => this.change(lobbyId, run.id, (current, state) => {
        signal.throwIfAborted();
        if (current.state !== 'provisioning' || !state.policy?.workspaceEnabled || current.deadline <= Date.now()) {
          throw new HostedControlError('Workspace execution has stopped.');
        }
        if (current.allocation?.createRequestedAt !== undefined) return false;
        current.allocation = { createRequestedAt: Date.now() };
        audit(state, 'hosted', 'workspace_create_requested', run.id);
        return true;
      }),
      bind: providerId => this.change(lobbyId, run.id, current => {
        if (!providerId || providerId.length > 200 || current.allocation?.createRequestedAt === undefined) {
          throw new Error('Invalid workspace allocation identity.');
        }
        if (current.allocation.providerId && current.allocation.providerId !== providerId) {
          throw new Error('Workspace allocation identity changed.');
        }
        current.allocation.providerId = providerId;
      }),
    };
    const advance = (next: HostedRun['state']) => this.change(lobbyId, run.id, (current, state) => {
      if (terminal(current) || !state.policy?.workspaceEnabled || Date.now() >= current.deadline) {
        throw new HostedControlError('Workspace execution has stopped.');
      }
      signal.throwIfAborted();
      current.state = next;
      audit(state, 'hosted', 'workspace_' + next, run.id);
    });
    if (!terminal(run)) {
      try {
        if (run.state === 'requested' || run.state === 'provisioning') {
          advance('provisioning');
          let sourceAccessDenied = false;
          try {
            const source = this.readSource ? async () => {
              const checkSourceAccess = async () => {
                const [task, integration] = await Promise.all([
                  this.store.getTask(lobbyId, attempt.taskId),
                  this.store.getIntegration(lobbyId, 'github'),
                ]);
                signal.throwIfAborted();
                if (!task || task.status === 'cancelled' || (attempt.assignedAgentId && task.assigned_to !== attempt.assignedAgentId)) {
                  sourceAccessDenied = true;
                  throw new HostedControlError('The task assignment changed before source staging.');
                }
                if (integration?.id !== attempt.sourceIntegrationId || integration?.repo_full_name !== attempt.sourceRepository) {
                  sourceAccessDenied = true;
                  throw new HostedControlError('The workspace source repository changed before staging.');
                }
                this.checkMarketplaceSource(lobbyId, attempt.taskId, attempt.sourceRepository, attempt.sourceRevision);
              };
              await checkSourceAccess();
              const archive = await this.readSource!(attempt, signal);
              await checkSourceAccess();
              return archive;
            } : undefined;
            await adapter.provision(run.id, attempt, credential, signal, allocation, source);
          } catch (error) {
            // The provider may have allocated before losing its response. Retry
            // with the same attempt key until the deadline, then fence and delete.
            if (!sourceAccessDenied && !signal.aborted && Date.now() < run.deadline) return;
            throw error;
          }
          advance('running');
        }
        if (run.state !== 'collecting') {
          signal.throwIfAborted();
          if (this.workspaceAgent) {
            const task = await this.store.getTask(lobbyId, attempt.taskId);
            if (task?.output_mode === 'workspace' && run.workspaceAgent !== 'finished') {
              if (!adapter.openFileTools) throw new HostedControlError('The workspace provider does not offer agent file tools.');
              if (run.workspaceAgent === 'started') throw new HostedControlError('Workspace agent was interrupted. Launch a new attempt.');
              const tools = await adapter.openFileTools(credential, signal, allocation);
              this.change(lobbyId, run.id, current => { current.workspaceAgent = 'started'; });
              await this.workspaceAgent(run.id, attempt, tools, signal);
              this.change(lobbyId, run.id, current => { current.workspaceAgent = 'finished'; });
            }
          }
          await adapter.wait(run.id, credential, signal, allocation);
          advance('collecting');
        }
        signal.throwIfAborted();
        const collected = await adapter.collect(run.id, credential, signal, allocation);
        const textArtifact = (value: string | undefined, limit: number) =>
          value?.replaceAll(credential, '[redacted]').slice(0, limit);
        const patchUnavailable = collected.patch?.includes(credential) ? 'credential_redacted'
          : collected.patch && Buffer.byteLength(collected.patch) > 262_144 ? 'size_limit' : collected.patchUnavailable;
        const artifacts: NonNullable<HostedRun['artifacts']> = {
          exitCode: Number.isInteger(collected.exitCode) ? collected.exitCode : undefined,
          logs: textArtifact(collected.logs, 65_536),
          tests: textArtifact(collected.tests, 65_536),
          patch: patchUnavailable ? undefined : collected.patch,
          patchUnavailable,
          files: collected.files?.slice(0, 100).map(file => textArtifact(file, 512)!),
        };
        signal.throwIfAborted();
        if (artifacts.exitCode) this.finish(lobbyId, run.id, 'failed', 'Workspace command exited unsuccessfully.', artifacts);
        else this.finish(lobbyId, run.id, 'succeeded', undefined, artifacts);
      } catch {
        if (this.closed) return;
        this.finish(lobbyId, run.id, 'failed', 'Workspace execution stopped or failed.');
      }
    }
    if (this.closed) return;
    const cleanup = await adapter.destroy(run.id, credential, AbortSignal.timeout(30_000), allocation);
    this.change(lobbyId, run.id, (current, state) => {
      if (cleanup.confirmed && current.cleanup === 'pending') {
        current.cleanup = 'confirmed';
        audit(state, 'hosted', 'workspace_deleted', run.id);
      }
      if (cleanup.confirmed && integer(cleanup.actual, Number.MAX_SAFE_INTEGER) && current.usage[0].actual === undefined) {
        current.usage[0].actual = cleanup.actual;
        audit(state, 'hosted', cleanup.actual > current.usage[0].reserved
          ? 'workspace_reservation_exceeded' : 'workspace_usage_reconciled', run.id);
      }
    });
  }

  auditHistory(lobbyId: string, offset: number, limit: number) {
    const events = this.store.readHostedState(lobbyId).audit;
    return { data: events.slice().reverse().slice(offset, offset + limit), total: events.length, offset, limit };
  }

  recover(onlyLobby?: string, actor?: string) {
    if (onlyLobby && actor) {
      this.store.mutateHostedState(onlyLobby, state => audit(state, actor, 'hosted_recovery_requested'));
    }
    for (const lobbyId of onlyLobby ? [onlyLobby] : this.store.hostedLobbyIds()) {
      for (const run of this.store.readHostedState(lobbyId).runs) {
        if (run.kind === 'model' && !terminal(run) && !this.active.has(run.id)) {
          this.finish(lobbyId, run.id, 'failed', 'Model run interrupted by restart. Unconfirmed usage remains reserved.');
        }
        this.kick(lobbyId, run.id);
      }
    }
  }

  close() {
    this.closed = true;
    for (const controller of this.active.values()) controller.abort();
  }
}
