// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { createHash, randomUUID } from 'node:crypto';
import { MarketplaceError } from './marketplace.js';
import { newMarketplaceDelivery, type MarketplaceAgreement, type MarketplaceSubmission } from './marketplace-state.js';
import type { HostedControls } from './hosted/hosted-controls.js';
import type { LobbyStore } from './store.js';

function required(value: unknown, label: string, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new MarketplaceError(`Enter ${label}.`, 400);
  return value.trim();
}

function revision(value: unknown, label: string, length: number): string {
  const result = required(value, label, length).toLowerCase();
  if (result.length !== length || !/^[0-9a-f]+$/.test(result)) throw new MarketplaceError(`Enter a valid ${label}.`, 400);
  return result;
}

const openWork = new Set(['assigned', 'in_progress', 'revision_requested']);
const finalWork = new Set(['accepted', 'cancelled', 'expired']);

export class MarketplaceDeliveryService {
  constructor(private readonly store: LobbyStore, private readonly hosted: HostedControls,
    private readonly verifyOwner: (did: string, owner: string) => Promise<boolean>) {}

  canExecute(lobbyId: string, taskId: string): boolean {
    const agreement = this.store.readMarketplaceState(lobbyId).agreements.find(entry => entry.assignmentId === taskId);
    return !agreement || (agreement.listing.deadline > Date.now() && openWork.has(agreement.delivery?.status ?? 'assigned'));
  }

  isMarketplaceTask(lobbyId: string, taskId: string): boolean {
    return this.store.readMarketplaceState(lobbyId).agreements.some(entry => entry.assignmentId === taskId);
  }

  async recover() {
    for (const lobby of await this.store.listLobbies()) {
      for (const agreement of this.store.readMarketplaceState(lobby.lobby_id).agreements) {
        if (agreement.delivery?.status === 'cancelled') await this.revoke(lobby.lobby_id, agreement, 'system');
        else await this.expire(lobby.lobby_id, agreement);
      }
    }
  }

  private getAgreement(lobbyId: string, id: string, actor: string, reviewer: boolean) {
    const agreement = this.store.readMarketplaceState(lobbyId).agreements.find(entry => entry.id === id);
    if (!agreement || !(reviewer || agreement.listing.buyer === actor || agreement.bid.specialist === actor)) {
      throw new MarketplaceError('Engagement not found.', 404);
    }
    return agreement;
  }

  async get(lobbyId: string, id: string, actor: string, reviewer: boolean, offset: number, limit: number) {
    const agreement = this.getAgreement(lobbyId, id, actor, reviewer);
    await this.expire(lobbyId, agreement);
    const current = this.getAgreement(lobbyId, id, actor, reviewer);
    const delivery = current.delivery ?? newMarketplaceDelivery();
    const task = await this.store.getTask(lobbyId, current.assignmentId);
    const runs = this.store.readHostedState(lobbyId).runs.filter(run => run.taskId === current.assignmentId && run.kind === 'workspace');
    return { status: delivery.status, version: delivery.version, termsDigest: current.buyerConsent.digest,
      isBuyer: current.listing.buyer === actor, isSpecialist: current.bid.specialist === actor, reviewer,
      assignee: current.bid.agentId, taskStatus: task?.status, workspaceRuns: runs.map(run => ({
        id: run.id, state: run.state, attemptId: run.attempt?.attemptId, sourceRevision: run.attempt?.sourceRevision, cleanup: run.cleanup,
      })),
      data: delivery.submissions.slice().reverse().slice(offset, offset + limit), total: delivery.submissions.length, offset, limit,
      history: { data: delivery.history.slice().reverse().slice(offset, offset + limit), total: delivery.history.length, offset, limit },
      feedback: delivery.feedback.filter(entry => reviewer || !entry.hidden),
    };
  }

  async workspaceArtifact(lobbyId: string, id: string, actor: string, reviewer: boolean, runId: string) {
    const agreement = this.getAgreement(lobbyId, id, actor, reviewer);
    if (!agreement.delivery?.submissions.some(submission => submission.workspaceRunId === runId)) {
      throw new MarketplaceError('Artifact not found.', 404);
    }
    return this.hosted.workspaceEvidence(lobbyId, runId);
  }

  async change(lobbyId: string, id: string, actor: string, reviewer: boolean, body: Record<string, unknown>) {
    const agreement = this.getAgreement(lobbyId, id, actor, reviewer);
    await this.expire(lobbyId, agreement);
    const specialist = agreement.bid.specialist === actor;
    const buyer = agreement.listing.buyer === actor;
    const action = required(body.action, 'a delivery action', 50);
    if (action === 'start' || action === 'submit') {
      const profile = this.store.readMarketplaceState(lobbyId).profiles.find(entry => entry.id === agreement.bid.profileId);
      if (!specialist || !profile || !await this.verifyOwner(profile.agentDid, actor)) {
        throw new MarketplaceError('The assigned specialist must have active registry ownership.', 403);
      }
    }
    const evidence = action === 'submit' ? await this.evidence(lobbyId, agreement, body) : undefined;
    const delivery = this.store.mutateMarketplaceState(lobbyId, state => {
      const current = state.agreements.find(entry => entry.id === id)!;
      const delivery = current.delivery ??= newMarketplaceDelivery();
      if (body.version !== delivery.version || body.termsDigest !== current.buyerConsent.digest) {
        throw new MarketplaceError('Delivery changed. Refresh and review the current version.');
      }
      const latest = delivery.submissions.at(-1);
      let reason: string | undefined;
      let reference: string | undefined;
      switch (action) {
        case 'start':
          if (!openWork.has(delivery.status) || delivery.status === 'in_progress') throw new MarketplaceError('This assignment cannot start.');
          delivery.status = 'in_progress';
          break;
        case 'submit':
          if (!openWork.has(delivery.status) || !evidence || delivery.submissions.some(entry => entry.attemptId === evidence.attemptId)) {
            throw new MarketplaceError('This attempt cannot be submitted.');
          }
          evidence.version = delivery.submissions.length + 1;
          delivery.submissions.push(evidence);
          delivery.status = 'submitted';
          reference = evidence.id;
          break;
        case 'accept':
        case 'revise':
          if (!buyer) throw new MarketplaceError('Only the buyer can review delivery.', 403);
          if (delivery.status !== 'submitted' || !latest || body.submissionId !== latest.id) {
            throw new MarketplaceError('Choose the current submission for review.');
          }
          delivery.status = action === 'accept' ? 'accepted' : 'revision_requested';
          if (action === 'revise') reason = required(body.reason, 'a revision reason');
          reference = latest.id;
          break;
        case 'dispute':
          if (!buyer && !specialist) throw new MarketplaceError('Only participants can open a dispute.', 403);
          if (finalWork.has(delivery.status) || delivery.status === 'disputed') throw new MarketplaceError('This engagement cannot be disputed.');
          reason = required(body.reason, 'a dispute reason');
          reference = latest?.id;
          delivery.status = 'disputed';
          break;
        case 'resolve':
          if (!reviewer || buyer || specialist) throw new MarketplaceError('An independent reviewer is required.', 403);
          if (delivery.status !== 'disputed' || (body.decision !== 'revision_requested' && body.decision !== 'cancelled')) {
            throw new MarketplaceError('Choose a valid resolution for an open dispute.');
          }
          reason = required(body.reason, 'a resolution reason');
          reference = required(body.reference, 'a resolution reference', 512);
          delivery.status = body.decision;
          break;
        case 'cancel':
          if (!buyer && !specialist && !reviewer) throw new MarketplaceError('Cancellation forbidden.', 403);
          if (finalWork.has(delivery.status) || delivery.status === 'disputed') throw new MarketplaceError('This engagement cannot be cancelled.');
          reason = required(body.reason, 'a cancellation reason');
          delivery.status = 'cancelled';
          break;
        case 'feedback':
          if ((!buyer && !specialist) || delivery.status !== 'accepted' || delivery.feedback.some(entry => entry.actor === actor)) {
            throw new MarketplaceError('Feedback is limited to one entry per participant on accepted work.');
          }
          reference = randomUUID();
          delivery.feedback.push({ id: reference, actor, text: required(body.text, 'feedback', 2000), hidden: false });
          break;
        case 'hide_feedback': {
          if (!reviewer) throw new MarketplaceError('Reviewer authorization required.', 403);
          const feedback = delivery.feedback.find(entry => entry.id === body.reference);
          if (!feedback || feedback.hidden) throw new MarketplaceError('Feedback not found.', 404);
          reason = required(body.reason, 'a moderation reason');
          reference = feedback.id;
          feedback.hidden = true;
          break;
        }
        default: throw new MarketplaceError('Choose a delivery action.', 400);
      }
      delivery.version++;
      delivery.history.push({ actor, action, at: Date.now(), reason, reference });
      return delivery;
    });
    if (delivery.status === 'cancelled') await this.revoke(lobbyId, agreement, actor);
    if (delivery.status === 'disputed') this.hosted.cancelTaskExecution(lobbyId, agreement.assignmentId, actor);
    if (delivery.status === 'revision_requested') {
      const task = await this.store.getTask(lobbyId, agreement.assignmentId);
      if (task) await this.store.upsertTask({ ...task, status: 'assigned', completed_at: undefined, result: undefined });
    }
    return delivery;
  }

  private async evidence(lobbyId: string, agreement: MarketplaceAgreement, body: Record<string, unknown>): Promise<MarketplaceSubmission> {
    const execution = body.execution;
    if (execution !== 'local' && execution !== 'hosted' && execution !== 'cloud') throw new MarketplaceError('Choose an execution path.', 400);
    const sourceRevision = revision(body.sourceRevision, 'source commit', 40);
    const submission: MarketplaceSubmission = { id: randomUUID(), version: 0, termsDigest: agreement.buyerConsent.digest,
      execution, sourceRevision, attemptId: required(body.attemptId, 'an attempt ID', 256), testResults: '', submittedAt: Date.now() };
    if (execution === 'cloud') {
      const run = this.store.readHostedState(lobbyId).runs.find(entry => entry.id === body.workspaceRunId &&
        entry.kind === 'workspace' && entry.taskId === agreement.assignmentId && entry.state === 'succeeded');
      const approved = agreement.listing.workspaceSource;
      if (!approved || approved.revision !== sourceRevision ||
          approved.repository.toLowerCase() !== run?.attempt?.sourceRepository?.toLowerCase() ||
          run.attempt.sourceRevision !== sourceRevision || run.attempt.attemptId !== submission.attemptId || !run.artifacts?.patch) {
        throw new MarketplaceError('Choose a successful workspace run with patch evidence for this assignment.');
      }
      submission.workspaceRunId = run.id;
      submission.patchDigest = createHash('sha256').update(run.artifacts.patch).digest('hex');
      submission.testResults = run.artifacts.tests ?? `Workspace exit code ${run.artifacts.exitCode ?? 'unavailable'}`;
    } else {
      const task = await this.store.getTask(lobbyId, agreement.assignmentId);
      const run = this.store.readHostedState(lobbyId).runs.find(entry => entry.id === submission.attemptId &&
        entry.kind === 'model' && entry.taskId === agreement.assignmentId && entry.state === 'succeeded');
      if (task?.assigned_to !== agreement.bid.agentId || task.status !== 'completed' || (execution === 'hosted' && !run)) {
        throw new MarketplaceError('Complete the assigned task using the selected execution path first.');
      }
      if (body.pullRequestCommit) submission.pullRequestCommit = revision(body.pullRequestCommit, 'pull request commit', 40);
      else submission.patchDigest = revision(body.patchDigest, 'patch digest', 64);
      submission.testResults = required(body.testResults, 'test results');
    }
    return submission;
  }

  private async expire(lobbyId: string, agreement: MarketplaceAgreement) {
    if (agreement.listing.deadline > Date.now() || agreement.delivery?.status === 'disputed') return;
    if (!finalWork.has(agreement.delivery?.status ?? 'assigned')) {
      this.store.mutateMarketplaceState(lobbyId, state => {
        const delivery = state.agreements.find(entry => entry.id === agreement.id)!.delivery ??= newMarketplaceDelivery();
        if (finalWork.has(delivery.status) || delivery.status === 'disputed') return;
        delivery.status = 'expired';
        delivery.version++;
        delivery.history.push({ actor: 'system', action: 'expire', at: Date.now() });
      });
    }
    const status = this.store.readMarketplaceState(lobbyId).agreements.find(entry => entry.id === agreement.id)?.delivery?.status;
    if (status === 'expired' || status === 'cancelled') await this.revoke(lobbyId, agreement, 'system');
  }

  private async revoke(lobbyId: string, agreement: MarketplaceAgreement, actor: string) {
    this.hosted.cancelTaskExecution(lobbyId, agreement.assignmentId, actor);
    const task = await this.store.getTask(lobbyId, agreement.assignmentId);
    if (task && task.status !== 'cancelled') await this.store.upsertTask({ ...task, status: 'cancelled' });
  }
}
