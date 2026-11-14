#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * verify-lobby — functional verification for the independent lobby server.
 *
 *   Part A (unit): drive the LobbyCoordinator directly and assert the server-side rules —
 *     floor control (non-boss broadcast rejected), lobby-scoping, directed-task-only, private
 *     access control, boss authority, hand-raise, monotonic seq, and the event log.
 *   Part B (integration): boot the real HTTP/WS server and connect two LobbyClients — assert
 *     register/roster, boss broadcast fan-out, non-boss broadcast rejection, and that a second
 *     lobby never receives the first lobby's messages (scoping enforced on the wire).
 *
 * No external services; exits non-zero on the first failure.
 */

import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AgentToLobbyMessage, LobbyToAgentMessage, LobbySession } from '@agent-os/protocol-core';
import { InMemoryLobbyStore, LobbyCoordinator, startLobbyServer, RegistrySponsorClient, type Connection } from '@agent-os/lobby-server';
import { LobbyClient } from '@agent-os/lobby-client';
import { issueSessionToken } from '../../packages/lobby-server/src/auth/identityProof.js';
import { createRegistryRosterVerifier } from '../../packages/lobby-server/src/hosted/registry-roster-verifier.js';
import { resolveProviderKey, setProviderKey } from '../../packages/lobby-server/src/providers/key-custody.js';
import { WebSocket } from 'ws';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Marketplace } from '../../packages/lobby-server/src/marketplace.js';
import { MarketplaceDeliveryService } from '../../packages/lobby-server/src/marketplace-delivery.js';
import { HostedControls } from '../../packages/lobby-server/src/hosted/hosted-controls.js';

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}\n    ${(err as Error).message.split('\n').join('\n    ')}`);
  }
}

const types = (out: { message: LobbyToAgentMessage }[]): string[] => out.map((o) => o.message.type);
const find = <T extends LobbyToAgentMessage['type']>(out: { message: LobbyToAgentMessage }[], t: T) =>
  out.find((o) => o.message.type === t)?.message as Extract<LobbyToAgentMessage, { type: T }> | undefined;

function makeLobby(visibility: 'public' | 'private', allowlist?: string[]): LobbySession {
  const now = new Date().toISOString();
  return {
    lobby_id: randomUUID(),
    org_id: 'default',
    name: 'test',
    status: 'active',
    visibility,
    allowlist,
    connected_agent_ids: [],
    message_seq: 0,
    created_at: now,
    updated_at: now,
    created_by: 'system',
  };
}

async function unitSetup(visibility: 'public' | 'private' = 'public', allowlist?: string[]) {
  const store = new InMemoryLobbyStore();
  const lobby = makeLobby(visibility, allowlist);
  await store.createLobby(lobby);
  const coord = new LobbyCoordinator(store);
  return { store, coord, lobbyId: lobby.lobby_id };
}

async function register(coord: LobbyCoordinator, lobbyId: string, name: string, extra: Partial<Extract<AgentToLobbyMessage, { type: 'lobby-register' }>> = {}, human = false) {
  const conn: Connection = { connId: randomUUID(), lobbyId, orgId: 'default' };
  const r = await coord.handle(conn, { type: 'lobby-register', display_name: name, ...(human ? { participant_type: 'human' } : {}), ...extra });
  return { conn, r };
}

// ── Integration helpers ──
function waitForMessage(client: LobbyClient, predicate: (m: LobbyToAgentMessage) => boolean, timeout = 3000): Promise<LobbyToAgentMessage> {
  return new Promise((resolve, reject) => {
    const off = client.onMessage((m) => {
      if (predicate(m)) {
        off();
        clearTimeout(timer);
        resolve(m);
      }
    });
    const timer = setTimeout(() => {
      off();
      reject(new Error('timeout waiting for message'));
    }, timeout);
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('verify-lobby — independent lobby server\n');

  // ════════ Part A — unit (coordinator rules) ════════
  console.log('Part A — coordinator (server-side rules)');
  await check('Marketplace beta flag rollback preserves preview history and blocks cross-lobby reads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'marketplace-rollback-'));
    const previous = process.env.AGENT_OS_MARKETPLACE_BETA;
    const store = new InMemoryLobbyStore(join(directory, 'store.json'));
    const owner = 'did:ccd:testnet:fixture-owner';
    const lobby = { ...makeLobby('private', [owner]), created_by: owner };
    await store.createLobby(lobby);
    const now = new Date().toISOString();
    await store.createMarketplaceTask({ id: 'preview', lobby_id: lobby.lobby_id, title: 'Preview', description: 'History',
      status: 'posted', posted_by_identity_ref: owner, proposed_budget_ccd: 0, created_at: now, updated_at: now });
    const running = await startLobbyServer({ port: 0, store, autoDefaultLobby: false });
    try {
      const address = running.httpServer.address() as import('node:net').AddressInfo;
      const url = 'http://127.0.0.1:' + address.port + '/api/v1/agent-lobby/lobbies/' + lobby.lobby_id + '/marketplace/listings';
      const read = (tokenLobby = lobby.lobby_id) => fetch(url, {
        headers: { Authorization: 'Bearer ' + issueSessionToken(owner, tokenLobby) },
      });
      delete process.env.AGENT_OS_MARKETPLACE_BETA;
      const enabled = await read();
      assert.equal(enabled.status, 200);
      assert.equal((await enabled.json()).legacy[0].id, 'preview');
      assert.equal((await read('other-lobby')).status, 401);
      const publicLobby = makeLobby('public');
      await store.createLobby(publicLobby);
      const publicUrl = url.replace(lobby.lobby_id, publicLobby.lobby_id);
      assert.equal((await fetch(publicUrl)).status, 401);
      const publish = (amount: string) => fetch(publicUrl, { method: 'POST',
        headers: { Authorization: 'Bearer ' + issueSessionToken(owner, publicLobby.lobby_id), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish', title: 'Quoted work', deliverable: 'Deliver result',
          acceptanceChecks: ['Review result'], scope: 'Artifact only', deadline: Date.now() + 86_400_000, amount }) });
      assert.equal((await publish('1.0000001')).status, 400);
      const quoted = await publish('12.340000');
      assert.equal(quoted.status, 200);
      assert.equal((await quoted.json()).listing.quote.amount, '12.34');
      const member = 'did:ccd:testnet:unrelated';
      await store.updateLobby(lobby.lobby_id, { allowlist: [owner, member] });
      const task = { task_id: 'private-assignment', lobby_id: lobby.lobby_id, org_id: 'default', title: 'Private',
        description: 'Private scope', assigned_by: 'LobbyOwner', assigned_to: 'agent', assigned_at: now,
        priority: 'normal', category: 'general', status: 'assigned' } as const;
      await store.upsertTask(task);
      store.mutateMarketplaceState(lobby.lobby_id, state => {
        state.agreements.push({ id: 'agreement', assignmentId: task.task_id,
          listing: { buyer: owner } as never, bid: { specialist: 'seller' } as never,
          buyerConsent: { actor: owner, at: Date.now(), digest: 'fixture' }, handoff: { task, status: 'dispatched' } });
      });
      const tasksUrl = url.replace('/marketplace/listings', '/tasks');
      const as = (actor: string) => ({ Authorization: 'Bearer ' + issueSessionToken(actor, lobby.lobby_id) });
      const privateTasks = await fetch(tasksUrl, { headers: as(member) });
      assert.equal(privateTasks.status, 200);
      assert.deepEqual((await privateTasks.json()).coordination_tasks, []);
      const ownerTasks = await fetch(tasksUrl, { headers: as(owner) });
      assert.equal((await ownerTasks.json()).coordination_tasks[0].task_id, task.task_id);
      assert.equal((await fetch(tasksUrl + '/' + task.task_id + '/delete', { method: 'POST', headers: as(member) })).status, 409);
      assert.ok(await store.getTask(lobby.lobby_id, task.task_id));
      process.env.AGENT_OS_MARKETPLACE_BETA = 'false';
      assert.equal((await read()).status, 404);
      assert.equal((await store.getMarketplaceTask(lobby.lobby_id, 'preview'))?.title, 'Preview');
    } finally {
      if (previous === undefined) delete process.env.AGENT_OS_MARKETPLACE_BETA;
      else process.env.AGENT_OS_MARKETPLACE_BETA = previous;
      await running.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  await check('Marketplace delivery pins all three execution paths and rejects conflicting review or artifact access', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'marketplace-delivery-'));
    try {
      const store = new InMemoryLobbyStore(join(directory, 'lobbies.json'));
      const lobby = makeLobby('private');
      const id = lobby.lobby_id;
      await store.createLobby(lobby);
      const marketplace = new Marketplace(store, async () => true, async () => {});
      const hosted = new HostedControls(store);
      const delivery = new MarketplaceDeliveryService(store, hosted, async () => true);
      const now = new Date().toISOString();
      await store.addAgent(id, { agent_id: 'worker', display_name: 'Worker', role: 'worker', participant_type: 'cli_agent',
        status: 'idle', current_work: '', registered_at: now, last_seen: now, identity_ref: 'did:ccd:testnet:worker' });
      const profile = await marketplace.profile(id, 'seller', { action: 'publish', agentDid: 'did:ccd:testnet:worker', displayName: 'Worker',
        skills: ['Testing'], runtimes: ['Local', 'Hosted', 'Cloud'], availability: 'Today', workSamples: ['Example'] }, false);
      for (const execution of ['local', 'hosted', 'cloud']) {
        const listing = marketplace.listing(id, 'buyer', { action: 'publish', title: execution, deliverable: 'Check', scope: 'reports/',
          acceptanceChecks: ['Pass'], deadline: Date.now() + 86_400_000, amount: '0',
          ...(execution === 'cloud' && { workspaceRepository: 'example/approved', workspaceRevision: 'a'.repeat(40) }) });
        const bid = await marketplace.bid(id, 'seller', listing.id, { action: 'submit', profileId: profile.id, agentId: 'worker',
          listingVersion: listing.version, amount: execution === 'local' ? '42.250000' : '0', turnaroundHours: 1, expiresAt: Date.now() + 3_600_000,
          prerequisites: 'None', assumptions: 'Fixture' });
        const termsDigest = bid.consent.digest;
        const agreement = await marketplace.hire(id, 'buyer', listing.id, { listingVersion: listing.version, bidVersion: bid.version,
          bidId: bid.id, digest: termsDigest });
        assert.equal(agreement.bid.quote.amount, execution === 'local' ? '42.25' : '0');
        const task = (await store.getTask(id, agreement.assignmentId))!;
        const request = { taskId: task.task_id, attemptId: 'scope-fixture', connectionId: 'fixture',
          sourceRevision: 'a'.repeat(40), profileId: 'fixture', region: 'fixture' };
        const before = store.readHostedState(id).runs.length;
        if (execution === 'cloud') {
          const integration = await store.addIntegration({ id: 'fixture-repo', lobby_id: id, provider: 'github', status: 'active',
            repo_full_name: 'example/approved', scopes: [], installed_by_identity_ref: 'buyer', created_at: now, updated_at: now });
          const cloudControls = new HostedControls(store, [], async () => assert.fail('Denied staging must not read source'));
          assert.deepEqual(agreement.listing.workspaceSource, { repository: 'example/approved', revision: request.sourceRevision });
          await assert.rejects(cloudControls.requestWorkspace(id, 'buyer', { ...request, sourceRevision: 'b'.repeat(40) }),
            /does not authorize staging/);
          await assert.rejects(cloudControls.requestWorkspace(id, 'buyer', request), /Set hosted limits/);
          await store.updateIntegration(id, integration.id, { repo_full_name: 'example/other' });
          await assert.rejects(cloudControls.requestWorkspace(id, 'buyer', request), /does not authorize staging/);
        } else {
          await assert.rejects(hosted.requestWorkspace(id, 'buyer', request), /does not authorize staging/);
        }
        assert.equal(store.readHostedState(id).runs.length, before, 'denied staging must not create a reservation');
        await store.upsertTask({ ...task, status: 'completed' });
        const sourceRevision = 'a'.repeat(40);
        const attemptId = `attempt-${execution}`;
        const workspaceRunId = 'cloud-fixture';
        store.mutateHostedState(id, state => {
          if (execution === 'hosted') state.runs.push({ id: attemptId, kind: 'model', taskId: task.task_id, state: 'succeeded',
            cleanup: 'confirmed', started: Date.now(), deadline: Date.now(), usage: [] });
          if (execution === 'cloud') state.runs.push({ id: workspaceRunId, kind: 'workspace', taskId: task.task_id,
            state: 'succeeded', cleanup: 'confirmed', started: Date.now(), deadline: Date.now(), usage: [],
            attempt: { lobbyId: id, taskId: task.task_id, attemptId, connectionId: 'fixture', sourceRevision, sourceRepository: 'example/other',
              profileId: 'fixture', region: 'fixture', deadline: Date.now() }, artifacts: { patch: 'patch evidence', tests: 'pass' } });
        });
        if (execution === 'cloud') {
          await assert.rejects(delivery.change(id, agreement.id, 'seller', false, { action: 'submit', version: 0,
            termsDigest, execution, attemptId, sourceRevision, workspaceRunId }), /Choose a successful workspace run/);
          assert.equal((await delivery.get(id, agreement.id, 'buyer', false, 0, 20)).total, 0);
          assert.deepEqual((await delivery.get(id, agreement.id, 'buyer', false, 0, 20)).workspaceRuns, []);
          store.mutateHostedState(id, state => {
            state.runs.find(run => run.id === workspaceRunId)!.attempt!.sourceRepository = 'example/approved';
          });
        }
        const submitted = await delivery.change(id, agreement.id, 'seller', false, { action: 'submit', version: 0,
          termsDigest, execution, attemptId, sourceRevision, workspaceRunId, patchDigest: 'b'.repeat(64), testResults: 'pass' });
        const submissionId = submitted.submissions[0].id;
        await assert.rejects(delivery.get(id, agreement.id, 'outsider', false, 0, 20), /not found/);
        if (execution === 'cloud') {
          await assert.rejects(delivery.workspaceArtifact(id, agreement.id, 'outsider', false, workspaceRunId), /not found/);
          assert.equal((await delivery.workspaceArtifact(id, agreement.id, 'buyer', false, workspaceRunId)).artifacts?.patch, 'patch evidence');
          store.mutateHostedState(id, state => {
            state.runs.find(run => run.id === workspaceRunId)!.artifacts!.patch = 'modified patch';
          });
          await assert.rejects(delivery.workspaceArtifact(id, agreement.id, 'buyer', false, workspaceRunId), /Artifact not found/);
          await assert.rejects(delivery.change(id, agreement.id, 'buyer', false, { action: 'accept', version: 1,
            termsDigest, submissionId }), /evidence is unavailable or has changed/);
          store.mutateHostedState(id, state => {
            state.runs.find(run => run.id === workspaceRunId)!.artifacts!.patch = 'patch evidence';
          });
          store.mutateHostedState(id, state => {
            state.runs.find(run => run.id === workspaceRunId)!.attempt!.sourceRepository = 'example/other';
          });
          await assert.rejects(delivery.workspaceArtifact(id, agreement.id, 'buyer', false, workspaceRunId), /Artifact not found/);
          store.mutateHostedState(id, state => {
            state.runs.find(run => run.id === workspaceRunId)!.attempt!.sourceRepository = 'example/approved';
          });
        }
        if (execution === 'hosted') {
          const results = await Promise.allSettled([
            delivery.change(id, agreement.id, 'seller', false, { action: 'dispute', version: 1, termsDigest, reason: 'Review scope' }),
            delivery.change(id, agreement.id, 'buyer', false, { action: 'accept', version: 1, termsDigest, submissionId }),
          ]);
          assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
          const snapshot = await delivery.get(id, agreement.id, 'reviewer', true, 0, 20);
          if (snapshot.status === 'disputed') {
            await assert.rejects(delivery.change(id, agreement.id, 'buyer', true, { action: 'resolve', version: 2, termsDigest,
              decision: 'cancelled', reason: 'Resolved', reference: 'record' }), /independent/);
            await delivery.change(id, agreement.id, 'reviewer', true, { action: 'resolve', version: 2, termsDigest,
              decision: 'cancelled', reason: 'Resolved', reference: 'record' });
            assert.equal((await store.getTask(id, agreement.assignmentId))?.status, 'cancelled');
          }
        } else if (execution === 'local') {
          const reopened = await delivery.change(id, agreement.id, 'buyer', false, { action: 'revise', version: 1,
            termsDigest, submissionId, reason: 'Improve check output' });
          assert.equal(reopened.status, 'revision_requested');
          assert.equal((await store.getTask(id, agreement.assignmentId))?.status, 'assigned');
          await store.upsertTask({ ...task, status: 'completed' });
          const next = await delivery.change(id, agreement.id, 'seller', false, { action: 'submit', version: 2, termsDigest,
            execution, attemptId: 'revision-attempt', sourceRevision, patchDigest: 'c'.repeat(64), testResults: 'pass' });
          assert.equal(next.submissions.length, 2);
          await delivery.change(id, agreement.id, 'buyer', false, { action: 'accept', version: 3, termsDigest,
            submissionId: next.submissions[1].id });
        } else {
          await delivery.change(id, agreement.id, 'buyer', false, { action: 'accept', version: 1, termsDigest, submissionId });
          await delivery.change(id, agreement.id, 'buyer', false, { action: 'feedback', version: 2, termsDigest, text: 'Verified' });
          await assert.rejects(delivery.change(id, agreement.id, 'buyer', false, { action: 'feedback', version: 3, termsDigest,
            text: 'Duplicate' }), /one entry/);
        }
        assert.equal(delivery.canExecute(id, agreement.assignmentId), false);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  await check('Marketplace beta preserves preview history and recovers one versioned hire after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'marketplace-beta-'));
    const filename = join(directory, 'lobbies.json');
    try {
      const store = new InMemoryLobbyStore(filename);
      const lobby = makeLobby('private');
      const id = lobby.lobby_id;
      await store.createLobby(lobby);
      const now = new Date().toISOString();
      await store.createMarketplaceTask({ id: 'preview', lobby_id: id, title: 'Historical', description: 'Historical',
        proposed_budget_ccd: 100, status: 'posted', posted_by_identity_ref: 'buyer', created_at: now, updated_at: now,
        escrow_signature: 'historical-wallet-signature' });
      await store.addAgent(id, { agent_id: 'specialist', display_name: 'Specialist', role: 'worker',
        participant_type: 'cli_agent', status: 'idle', current_work: '', registered_at: now, last_seen: now,
        identity_ref: 'did:ccd:testnet:fixture' });
      let verified = true;
      const verify = async (did: string, owner: string) => verified && did === 'did:ccd:testnet:fixture' && owner === 'owner';
      let dispatches = 0;
      const marketplace = new Marketplace(store, verify, async () => { dispatches++; throw new Error('dispatch interrupted'); });
      const profileBody = { action: 'publish', agentDid: 'did:ccd:testnet:fixture', displayName: 'Specialist', skills: ['TypeScript'],
        runtimes: ['API'], availability: 'Today', workSamples: ['sample'] };
      await assert.rejects(marketplace.profile(id, 'other', profileBody, false), /ownership/);
      const profile = await marketplace.profile(id, 'owner', profileBody, false);
      assert.equal((await marketplace.catalog(id, 'script', 'api', 0, 10)).total, 1);
      const listing = marketplace.listing(id, 'buyer', { action: 'publish', title: 'Verify delivery', deliverable: 'Run check',
        scope: 'reports/', acceptanceChecks: ['green checks'], deadline: Date.now() + 86_400_000, amount: '0' });
      const bid = await marketplace.bid(id, 'owner', listing.id, { action: 'submit', listingVersion: listing.version,
        agentId: 'specialist', profileId: profile.id, amount: '0', turnaroundHours: 2, expiresAt: Date.now() + 7_200_000,
        prerequisites: 'None', assumptions: 'Fixture only' });
      assert.equal(marketplace.bids(id, 'other', listing.id, 0, 10).total, 0);
      const approval = { bidId: bid.id, bidVersion: bid.version, listingVersion: listing.version, digest: bid.consent.digest };
      await assert.rejects(marketplace.hire(id, 'buyer', listing.id, { ...approval, digest: 'stale' }), /Terms changed/);
      verified = false;
      assert.equal((await marketplace.catalog(id, '', '', 0, 10)).total, 0);
      await assert.rejects(marketplace.hire(id, 'buyer', listing.id, approval), /no longer eligible/);
      verified = true;
      const racing = await Promise.allSettled([
        marketplace.hire(id, 'buyer', listing.id, approval), marketplace.hire(id, 'buyer', listing.id, approval),
      ]);
      assert.ok(racing.every(result => result.status === 'rejected'));
      assert.equal(dispatches, 1);
      const restarted = new InMemoryLobbyStore(filename);
      const retry = new Marketplace(restarted, verify, async () => { dispatches++; });
      const [agreement, duplicate] = await Promise.all([
        retry.hire(id, 'buyer', listing.id, approval), retry.hire(id, 'buyer', listing.id, approval),
      ]);
      assert.equal(agreement.id, duplicate.id);
      assert.equal(agreement.handoff.status, 'dispatched');
      assert.equal((await restarted.listTasks(id)).length, 1);
      assert.equal(dispatches, 2);
      assert.equal((await restarted.getMarketplaceTask(id, 'preview'))?.escrow_signature, 'historical-wallet-signature');
      assert.equal((await retry.listings(id, 'buyer', 0, 10)).legacy[0]?.legacyAuthorization, true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  await check('SPONSOR CLIENT: validates inputs, relays the unsigned tx, and surfaces upstream errors', async () => {
    const realFetch = globalThis.fetch;
    try {
      // Input validation — never hits the network with a malformed request.
      const c = new RegistrySponsorClient('https://sponsor.example/sponsor');
      assert.equal(c.url, 'https://sponsor.example/sponsor');
      const base = { genesisHash: 'abc', payload: { foo: 1 }, sender: '4DCywKkv', nonce: 5 };
      for (const bad of [
        { ...base, genesisHash: '' },
        { ...base, payload: null as unknown as Record<string, unknown> },
        { ...base, sender: '' },
        { ...base, nonce: 0 },
        { ...base, nonce: -1 },
        { ...base, nonce: 1.5 },
      ]) {
        await assert.rejects(() => c.sponsor(bad as never), /sponsor:/);
      }

      // Happy path — forwards exactly { genesisHash, payload, sender, nonce } and returns the JSON.
      let seen: unknown;
      globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
        seen = JSON.parse(init.body ?? '{}');
        return new Response(JSON.stringify({ signatures: { 0: { 0: 'deadbeef' } }, sponsored: true }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;
      const out = await c.sponsor(base);
      assert.deepEqual(seen, base);
      assert.equal((out as { sponsored: boolean }).sponsored, true);

      // Upstream failure — surfaces status + body so the caller can fall back to self-pay.
      globalThis.fetch = (async () =>
        new Response('nonce too low', { status: 409 })) as typeof fetch;
      await assert.rejects(() => c.sponsor(base), /HTTP 409: nonce too low/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await check('register returns registered + roster + agent-joined and assigns an id', async () => {
    const { coord, lobbyId } = await unitSetup();
    const { conn, r } = await register(coord, lobbyId, 'backend');
    assert.ok(conn.agentId, 'agent id assigned');
    assert.deepEqual(types(r.out).sort(), ['lobby-agent-joined', 'lobby-registered', 'lobby-roster']);
    const roster = find(r.out, 'lobby-roster');
    assert.equal(roster?.agents.length, 1);
  });

  await check('IMPERSONATION: external bare-DID is denied, but a trusted internal (hosted) connection is admitted with the verified badge', async () => {
    const store = new InMemoryLobbyStore();
    const lobby = makeLobby('public');
    await store.createLobby(lobby);
    const DID = 'did:ccd:mainnet:3verifiedacct';
    const verifyIdentity = async (ref: string) => ref === DID
      ? { status: 'registry_verified' as const, ref: { did: DID, account: '3verifiedacct', registry: 'reg', network: 'mainnet' as const }, source: 'indexer' as const, checkedAt: new Date().toISOString() }
      : { status: 'unverified' as const, source: 'none' as const, checkedAt: new Date().toISOString() };
    const coord = new LobbyCoordinator(store, { verifyIdentity });

    // An untrusted external WS client presenting only the bare DID (no session token) is denied —
    // this is the impersonation protection that stops anyone from claiming a DID they don't own.
    const extConn: Connection = { connId: randomUUID(), lobbyId: lobby.lobby_id, orgId: 'default' };
    const ext = await coord.handle(extConn, { type: 'lobby-register', display_name: 'ext', join_token: DID } as AgentToLobbyMessage);
    assert.ok(find(ext.out, 'lobby-error'), 'external bare-DID registration is denied');
    assert.ok(ext.close, 'connection is closed on denial');

    const signedConn: Connection = { connId: randomUUID(), lobbyId: lobby.lobby_id, orgId: 'default' };
    const signed = await coord.handle(signedConn, {
      type: 'lobby-register',
      display_name: 'signed local agent',
      agent_identity_ref: DID,
      join_token: issueSessionToken('did:ccd:mainnet:3verifiedacct', lobby.lobby_id),
    });
    assert.equal(find(signed.out, 'lobby-agent-joined')?.agent.identity_status, 'registry_verified');

    const wrongConn: Connection = { connId: randomUUID(), lobbyId: lobby.lobby_id, orgId: 'default' };
    const wrong = await coord.handle(wrongConn, {
      type: 'lobby-register',
      display_name: 'different wallet',
      agent_identity_ref: DID,
      join_token: issueSessionToken('did:ccd:mainnet:wrong-wallet', lobby.lobby_id),
    });
    assert.ok(wrong.close, 'another wallet cannot use the agent DID');

    // A trusted internal connection (a hosted agent on a virtual socket, spawned by the already
    // authenticated LobbyOwner) presenting the same DID is admitted AND gets the verified badge.
    const intConn: Connection = { connId: randomUUID(), lobbyId: lobby.lobby_id, orgId: 'default', trusted: true };
    const int = await coord.handle(intConn, { type: 'lobby-register', display_name: 'hosted', join_token: DID } as AgentToLobbyMessage);
    assert.ok(find(int.out, 'lobby-registered'), 'trusted registration admitted');
    const joined = find(int.out, 'lobby-agent-joined');
    assert.equal(joined?.agent?.identity_status, 'registry_verified', 'roster reflects the verified identity');
    assert.equal(joined?.agent?.identity_ref, DID, 'identity_ref bound on the roster record');
  });

  await check('hosted roster badges require an active registry record and the exact hosted card hash', async () => {
    const origin = 'https://lobby.example.test';
    const did = 'did:ccd:mainnet:agent-fixture';
    const card = { did, network: 'mainnet', ownerAddress: 'fixture-owner', name: 'Original' };
    const record = {
      network: 'mainnet', owner_account: card.ownerAddress, status: 'Active',
      token_id: 669,
      agent_uri: `http://lobby.example.test/agent-cards/${encodeURIComponent(did)}`,
      metadata_hash_hex: createHash('sha256').update(JSON.stringify(card)).digest('hex'),
    };
    let queries = 0;
    const verify = createRegistryRosterVerifier({
      async callTool(name, args) {
        assert.equal(name, 'agents_by_owner');
        assert.equal(args.owner_account, card.ownerAddress);
        queries++;
        return { agents: [record] };
      },
    }, origin, () => card, ['https://previous.example.test']);
    const { store, lobbyId } = await unitSetup();
    const coord = new LobbyCoordinator(store, { verifyHostedRosterIdentity: verify });
    const message = { type: 'lobby-register', display_name: 'fixture', join_token: did } as const;
    const connection = () => ({ connId: randomUUID(), lobbyId, orgId: 'default' });
    const hosted = await coord.handle({ ...connection(), trusted: true }, message);
    assert.equal(find(hosted.out, 'lobby-agent-joined')?.agent.identity_status, 'registry_verified');
    assert.equal(find(hosted.out, 'lobby-agent-joined')?.agent.identity_registry_links?.explorer,
      'https://ccdexplorer.io/mainnet/token/10082/0/9d02000000000000');
    const external = await coord.handle(connection(), message);
    assert.equal(find(external.out, 'lobby-agent-joined')?.agent.identity_status, 'unverified');
    const owner = `did:ccd:mainnet:${card.ownerAddress}`;
    await store.updateLobby(lobbyId, { visibility: 'private', join_policy: 'allowlisted', allowlist: [did] });
    const registerRelay = (identity: string) => coord.handle(connection(), {
      ...message, join_token: issueSessionToken(identity, lobbyId), agent_identity_ref: did,
    });
    const first = find((await registerRelay(owner)).out, 'lobby-agent-joined')?.agent;
    const restarted = find((await registerRelay(owner)).out, 'lobby-agent-joined')?.agent;
    assert.equal(first?.identity_ref, did);
    assert.equal(restarted?.identity_ref, did);
    assert.notEqual(first?.agent_id, restarted?.agent_id);
    assert.deepEqual(restarted?.identity_registry_links, first?.identity_registry_links);
    const wrongWallet = await registerRelay('did:ccd:mainnet:other');
    assert.match(find(wrongWallet.out, 'lobby-error')?.error ?? '', /impersonation protection/);
    assert.equal(wrongWallet.closeCode, 1008, 'the relay must wait for a valid wallet session');
    card.name = 'Modified';
    assert.equal((await verify(did)).status, 'unverified');
    card.name = 'Original';
    record.status = 'Revoked';
    assert.equal((await verify(did)).status, 'unverified');
    record.status = 'Active';
    record.agent_uri = record.agent_uri.replace('lobby.example.test', 'previous.example.test');
    assert.equal((await verify(did)).status, 'registry_verified');
    record.agent_uri = record.agent_uri.replace('previous.example.test', 'another.example.test');
    assert.equal((await verify(did)).status, 'unverified');
    assert.equal(queries, 1);
  });

  await check('FLOOR CONTROL: a non-boss broadcast is rejected (anti echo-cascade)', async () => {
    const { coord, lobbyId } = await unitSetup();
    const { conn } = await register(coord, lobbyId, 'backend');
    const r = await coord.handle(conn, { type: 'lobby-message', to_agent_id: 'all', message_type: 'chat', content: 'everyone hi' });
    assert.deepEqual(types(r.out), ['lobby-error']);
    assert.match(find(r.out, 'lobby-error')?.error ?? '', /floor control/i);
  });

  await check('production public guests can observe but cannot speak or appoint a Boss', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { store, coord, lobbyId } = await unitSetup();
      const owner = 'fixture-wallet';
      await store.updateLobby(lobbyId, { created_by: owner });
      const guest = await register(coord, lobbyId, 'guest', {}, true);
      assert.ok(guest.conn.agentId, 'guest can observe');
      assert.equal(guest.conn.isHuman, false, 'a guest cannot claim human privileges');
      const guestAppointment = await coord.handle(guest.conn, { type: 'lobby-boss-appoint', agent_id: guest.conn.agentId });
      assert.match(find(guestAppointment.out, 'lobby-error')?.error ?? '', /wallet session/);
      const guestChat = await coord.handle(guest.conn, { type: 'lobby-message', to_agent_id: 'all', message_type: 'chat', content: 'dispatch' });
      assert.match(find(guestChat.out, 'lobby-error')?.error ?? '', /wallet session/);
      const signed = await register(coord, lobbyId, 'owner', { join_token: issueSessionToken(owner, lobbyId) }, true);
      const appointment = await coord.handle(signed.conn, { type: 'lobby-boss-appoint', agent_id: signed.conn.agentId! });
      assert.ok(find(appointment.out, 'lobby-boss-appointed'));
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  await check('the Boss may broadcast; fan-out is lobby-scoped', async () => {
    const { coord, lobbyId } = await unitSetup();
    const { conn } = await register(coord, lobbyId, 'boss');
    await coord.handle(conn, { type: 'lobby-boss-appoint', agent_id: conn.agentId! });
    const r = await coord.handle(conn, { type: 'lobby-message', to_agent_id: 'all', message_type: 'coordination', content: 'roll call' });
    assert.deepEqual(types(r.out), ['lobby-message-received']);
    assert.equal(r.out[0].target.kind, 'lobby');
  });

  await check('a human participant may broadcast without being Boss', async () => {
    const { coord, lobbyId } = await unitSetup();
    const { conn } = await register(coord, lobbyId, 'Alice', {}, true);
    const r = await coord.handle(conn, { type: 'lobby-message', to_agent_id: 'all', message_type: 'chat', content: 'hello team' });
    assert.deepEqual(types(r.out), ['lobby-message-received']);
  });

  await check('directed message goes to the named recipient and echoes to the sender', async () => {
    const { coord, lobbyId } = await unitSetup();
    const a = await register(coord, lobbyId, 'a');
    const b = await register(coord, lobbyId, 'b');
    const r = await coord.handle(a.conn, { type: 'lobby-message', to_agent_id: b.conn.agentId!, message_type: 'chat', content: 'hi b' });
    const targets = r.out.map((o) => o.target.kind);
    assert.ok(targets.includes('agent') && targets.includes('self'));
  });

  await check('boss appointment is server-authoritative (a non-boss cannot seize it)', async () => {
    const { coord, lobbyId } = await unitSetup();
    const a = await register(coord, lobbyId, 'a');
    const b = await register(coord, lobbyId, 'b');
    await coord.handle(a.conn, { type: 'lobby-boss-appoint', agent_id: a.conn.agentId! }); // first appoint ok
    const seize = await coord.handle(b.conn, { type: 'lobby-boss-appoint', agent_id: b.conn.agentId! });
    assert.deepEqual(types(seize.out), ['lobby-error']);
  });

  await check('task-create to `*` is rejected; to a named agent it assigns', async () => {
    const { coord, lobbyId } = await unitSetup();
    const boss = await register(coord, lobbyId, 'boss');
    const worker = await register(coord, lobbyId, 'worker');
    const bad = await coord.handle(boss.conn, { type: 'lobby-task-create', assigned_to: '*', title: 't', description: 'd' });
    assert.deepEqual(types(bad.out), ['lobby-error']);
    const good = await coord.handle(boss.conn, { type: 'lobby-task-create', assigned_to: worker.conn.agentId!, title: 't', description: 'd' });
    assert.ok(types(good.out).includes('lobby-task-assigned') && types(good.out).includes('lobby-task-updated'));
    assert.equal(find(good.out, 'lobby-task-assigned')?.task.assigned_to, worker.conn.agentId);
  });

  await check('hand-raise broadcasts a structured hand to the lobby', async () => {
    const { coord, lobbyId } = await unitSetup();
    const { conn } = await register(coord, lobbyId, 'security');
    const r = await coord.handle(conn, { type: 'lobby-hand-raise', category: 'blocker', reason: 'no auth check' });
    assert.deepEqual(types(r.out), ['lobby-hand-raised']);
    assert.equal(find(r.out, 'lobby-hand-raised')?.hand.category, 'blocker');
  });

  await check('a PRIVATE lobby denies an agent not on the allowlist, admits one that is', async () => {
    const { coord, lobbyId } = await unitSetup('private', ['frontend']);
    const denied = await register(coord, lobbyId, 'intruder');
    assert.equal(denied.r.close, true);
    assert.deepEqual(types(denied.r.out), ['lobby-error']);
    assert.equal((await register(coord, lobbyId, 'frontend')).r.close, true, 'display name is not proof');
    const admitted = await register(coord, lobbyId, 'frontend', { join_token: issueSessionToken('frontend', lobbyId) });
    assert.ok(!admitted.r.close);
    assert.ok(types(admitted.r.out).includes('lobby-registered'));
  });

  await check('message seq is monotonic and the event log records actions + denials', async () => {
    const { store, coord, lobbyId } = await unitSetup();
    const boss = await register(coord, lobbyId, 'boss');
    await coord.handle(boss.conn, { type: 'lobby-boss-appoint', agent_id: boss.conn.agentId! });
    await coord.handle(boss.conn, { type: 'lobby-message', to_agent_id: 'all', message_type: 'chat', content: 'm1' });
    const worker = await register(coord, lobbyId, 'worker');
    await coord.handle(worker.conn, { type: 'lobby-message', to_agent_id: 'all', message_type: 'chat', content: 'illegal' }); // rejected
    const events = await store.listEvents(lobbyId);
    const seqs = events.map((e) => e.seq);
    assert.deepEqual([...seqs].sort((a, b) => a - b), seqs, 'event seq monotonic');
    assert.ok(events.some((e) => e.type === 'message_sent'));
    assert.ok(events.some((e) => e.type === 'message_rejected'), 'denial recorded for accountability');
  });

  await check('boss disconnecting emits boss-lost to the lobby', async () => {
    const { coord, lobbyId } = await unitSetup();
    const boss = await register(coord, lobbyId, 'boss');
    await coord.handle(boss.conn, { type: 'lobby-boss-appoint', agent_id: boss.conn.agentId! });
    const r = await coord.onDisconnect(boss.conn);
    assert.ok(types(r.out).includes('lobby-agent-left') && types(r.out).includes('lobby-boss-lost'));
  });

  // ════════ Part B — integration (real WS, two clients) ════════
  console.log('\nPart B — wire (real HTTP/WS server + clients)');

  const wireDirectory = await mkdtemp(join(tmpdir(), 'lobby-wire-'));
  const server = await startLobbyServer({ port: 4739, autoDefaultLobby: true,
    store: new InMemoryLobbyStore(join(wireDirectory, 'store.json')) });
  const lobbyUrl = `http://localhost:${server.port}`;
  const clients: LobbyClient[] = [];
  const mk = (name: string, lobbyId?: string) => {
    const c = new LobbyClient({ lobbyUrl, lobbyId, register: { type: 'lobby-register', display_name: name }, heartbeatMs: 0, reconnect: false });
    clients.push(c);
    return c;
  };

  try {
    await check('x401 test resource offers a challenge and rejects a replayed synthetic proof', async () => {
      const endpoint = lobbyUrl + '/api/v1/agent-lobby/x401/test-resource';
      const page = await fetch(lobbyUrl + '/panel/x401-test.html');
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Run proof test/);
      const challenge = await fetch(endpoint);
      assert.equal(challenge.status, 401);
      assert.ok(challenge.headers.get('proof-request'));
      assert.equal(challenge.headers.get('cache-control'), 'no-store');
      const invalid = await fetch(endpoint, { headers: { 'PROOF-RESPONSE': 'invalid' } });
      assert.equal(invalid.status, 401);
      assert.ok(invalid.headers.get('proof-result'));
      const denied = await fetch(endpoint + '/check', { method: 'POST' });
      assert.equal(denied.status, 404);
      await denied.body?.cancel();
      const checkResult = await fetch(endpoint + '/check', {
        method: 'POST', headers: { 'X-Agent-OS-Proof': '1' },
      });
      assert.equal(checkResult.status, 200);
      assert.deepEqual(await checkResult.json(), { proofStatus: 200, replayStatus: 401 });
    });

    await check('two clients register and see a shared roster over the wire', async () => {
      const a = mk('A');
      await a.connect();
      await waitForMessage(a, (m) => m.type === 'lobby-registered');
      const b = mk('B');
      const bRoster = waitForMessage(b, (m) => m.type === 'lobby-roster');
      const aSeesB = waitForMessage(a, (m) => m.type === 'lobby-agent-joined' && m.agent.display_name === 'B');
      await b.connect();
      const roster = (await bRoster) as Extract<LobbyToAgentMessage, { type: 'lobby-roster' }>;
      await aSeesB;
      assert.ok(roster.agents.some((ag) => ag.display_name === 'A'));
    });

    await check('boss broadcast reaches peers; a non-boss broadcast is rejected on the wire', async () => {
      const [a, b] = clients;
      // appoint A as boss
      a.send({ type: 'lobby-boss-appoint', agent_id: a.agentId! });
      await waitForMessage(b, (m) => m.type === 'lobby-boss-appointed');
      // boss A broadcasts → B receives
      const bGets = waitForMessage(b, (m) => m.type === 'lobby-message-received' && m.message.content === 'roll call');
      a.send({ type: 'lobby-message', to_agent_id: 'all', message_type: 'coordination', content: 'roll call' });
      await bGets;
      // non-boss B broadcasts → B gets an error back
      const bErr = waitForMessage(b, (m) => m.type === 'lobby-error');
      b.send({ type: 'lobby-message', to_agent_id: 'all', message_type: 'chat', content: 'illegal' });
      assert.match(((await bErr) as Extract<LobbyToAgentMessage, { type: 'lobby-error' }>).error, /floor control/i);
    });

    await check('live roster excludes a persisted stale session and reports the authoritative Boss', async () => {
      const [boss] = clients;
      const lobbyId = boss.lobbyId!;
      const live = (await server.store.getAgent(lobbyId, boss.agentId!))!;
      const stale = { ...live, agent_id: randomUUID(), display_name: 'Stale Boss session' };
      await server.store.addAgent(lobbyId, stale);
      try {
        const observer = mk('Roster verifier', lobbyId);
        const update = waitForMessage(observer, m => m.type === 'lobby-roster');
        await observer.connect();
        const snapshot = await update as Extract<LobbyToAgentMessage, { type: 'lobby-roster' }>;
        assert.equal(snapshot.boss_agent_id, boss.agentId);
        const response = await fetch(`${lobbyUrl}/api/v1/agent-lobby/lobbies/${lobbyId}/roster`);
        const { agents } = await response.json();
        assert.ok(agents.some((agent: { agent_id: string }) => agent.agent_id === boss.agentId));
        assert.ok(!agents.some((agent: { agent_id: string }) => agent.agent_id === stale.agent_id));
      } finally {
        await server.store.removeAgent(lobbyId, stale.agent_id);
      }
    });

    await check('LOBBY-SCOPING: a second lobby never receives the first lobby messages', async () => {
      // create a separate lobby and connect a client C to it
      const res = await fetch(new URL('/api/v1/agent-lobby/lobbies', lobbyUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'lobby2' }) });
      const { lobby } = (await res.json()) as { lobby: LobbySession };
      const c = mk('C', lobby.lobby_id);
      await c.connect();
      await waitForMessage(c, (m) => m.type === 'lobby-registered');
      let leaked = false;
      c.onMessage((m) => {
        if (m.type === 'lobby-message-received') leaked = true;
      });
      const [a] = clients;
      a.send({ type: 'lobby-message', to_agent_id: 'all', message_type: 'chat', content: 'lobby1 only' });
      await sleep(400);
      assert.equal(leaked, false, 'lobby 2 must not receive lobby 1 traffic');
    });

    await check('a lobby owner cannot revoke another lobby’s provider key', async () => {
      const first = { ...makeLobby('private'), created_by: 'provider-key-owner-a' };
      const second = { ...makeLobby('private'), created_by: 'provider-key-owner-b' };
      await server.store.createLobby(first);
      await server.store.createLobby(second);
      const env = { AGENT_OS_SECRET_ENCRYPTION_KEY: 'verify-lobby-provider-key-fixture' };
      const key = await setProviderKey(server.store, {
        lobbyId: second.lobby_id, provider: 'openai', apiKey: 'synthetic-key',
        identityRef: second.created_by, env,
      });
      const revoke = (lobby: LobbySession) => fetch(
        `${lobbyUrl}/api/v1/agent-lobby/lobbies/${lobby.lobby_id}/provider-keys/${key.id}`,
        { method: 'DELETE', headers: { authorization: `Bearer ${issueSessionToken(lobby.created_by, lobby.lobby_id)}` } },
      );
      assert.equal((await revoke(first)).status, 404);
      assert.equal((await resolveProviderKey(server.store, second.lobby_id, 'openai', undefined, env))?.apiKey, 'synthetic-key');
      assert.equal((await revoke(second)).status, 200);
      assert.equal(await resolveProviderKey(server.store, second.lobby_id, 'openai', undefined, env), null);
    });

    await check('private lobby discovery shows invitations across wallet sessions without granting cross-lobby access', async () => {
      const owner = 'did:ccd:mainnet:fixture-owner';
      const invited = 'did:ccd:mainnet:fixture-invite';
      const publicLobby = makeLobby('public');
      const lobby = { ...makeLobby('private'), created_by: owner, allowlist: [invited] };
      await server.store.createLobby(publicLobby);
      await server.store.createLobby(lobby);
      const endpoint = `${lobbyUrl}/api/v1/agent-lobby/lobbies`;
      const headers = (identity: string, id = publicLobby.lobby_id) => ({
        authorization: `Bearer ${issueSessionToken(identity, id)}`,
      });
      const discover = async (identity?: string) => {
        const response = await fetch(endpoint, { headers: identity ? headers(identity) : {} });
        return (await response.json()).lobbies.find((item: LobbySession) => item.lobby_id === lobby.lobby_id);
      };
      assert.equal(await discover(), undefined);
      assert.equal(await discover('did:ccd:mainnet:uninvited'), undefined);
      assert.equal((await discover(owner)).visibility, 'private');
      const invitation = await discover(invited);
      assert.equal(invitation.visibility, 'private');
      assert.equal(invitation.allowlist, undefined);
      assert.equal(invitation.created_by, undefined);
      const roster = `${endpoint}/${lobby.lobby_id}/roster`;
      assert.equal((await fetch(roster, { headers: headers(invited) })).status, 401);
      assert.equal((await fetch(roster, { headers: headers(invited, lobby.lobby_id) })).status, 200);
    });

    await check('private lobby management requires proof, and revocation and closure disconnect agents', async () => {
      const owner = 'test-owner';
      const member = 'test-member';
      const lobby = { ...makeLobby('private'), created_by: owner };
      await server.store.createLobby(lobby);
      const path = `${lobbyUrl}/api/v1/agent-lobby/lobbies/${lobby.lobby_id}`;
      const request = (suffix: string, method = 'GET', identity?: string, body?: unknown) => fetch(path + suffix, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(identity ? { authorization: `Bearer ${issueSessionToken(identity, lobby.lobby_id)}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal((await request('', 'PATCH', undefined, { status: 'closed' })).status, 401);
      assert.equal((await request('/members', 'POST', undefined, { identity_ref: member, role: 'admin' })).status, 401);
      assert.equal((await request('/events', 'GET', member)).status, 403);
      for (const route of ['/members', '/roster', '/messages', '/events', '/tasks', '/integrations/github']) {
        assert.equal((await request(route)).status, 401, route);
      }
      const invited = await request('/members', 'POST', owner, { identity_ref: member, role: 'contributor' });
      assert.equal(invited.status, 201);
      const { member: record } = await invited.json();
      const status = `/members/${record.id}/status`;
      assert.equal((await request(status, 'POST', owner, { status: 'active' })).status, 200);
      assert.equal((await request('/messages', 'GET', member)).status, 200);
      assert.equal((await request('', 'PATCH', member, { status: 'closed' })).status, 403);

      const wsUrl = new URL('/api/v1/agent-lobby/ws/agent', lobbyUrl.replace(/^http/, 'ws'));
      wsUrl.searchParams.set('lobby_id', lobby.lobby_id);
      const socket = new WebSocket(wsUrl);
      try {
        const registered = new Promise<void>((resolve, reject) => {
          socket.on('error', reject);
          socket.on('message', (data) => {
            const frame = JSON.parse(data.toString());
            if (frame.type === 'lobby-error') reject(new Error(frame.error));
            if (frame.type === 'lobby-registered') resolve();
          });
          socket.once('open', () => socket.send(JSON.stringify({
            type: 'lobby-register', display_name: 'Member', join_token: issueSessionToken(member, lobby.lobby_id),
          })));
        });
        await registered;
        const closed = new Promise((resolve) => socket.once('close', resolve));
        assert.equal((await request(status, 'POST', owner, { status: 'revoked', actor: 'spoofed' })).status, 200);
        assert.equal(await closed, 1008);
        const events = await (await request('/events', 'GET', owner)).json();
        assert.equal(events.events.find((event: { type: string }) => event.type === 'member_revoked')?.actor_id, owner);
        assert.equal((await request('', 'PATCH', owner, { status: 'closed' })).status, 200);
      } finally {
        socket.terminate();
      }
      const denied = mk('closed lobby probe', lobby.lobby_id);
      const error = waitForMessage(denied, (message) => message.type === 'lobby-error');
      await denied.connect();
      assert.match((await error as Extract<LobbyToAgentMessage, { type: 'lobby-error' }>).error, /not active/);
    });

    await check('test admin uses its configured key and is confined to a private test lobby', async () => {
      const key = randomBytes(32).toString('hex');
      const oldDigest = process.env.AGENT_OS_TEST_ADMIN_KEY_SHA256;
      const oldMode = process.env.NODE_ENV;
      const api = `${lobbyUrl}/api/v1/agent-lobby`;
      const request = (path: string, method: string, body: unknown, token?: string) => fetch(api + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      try {
        delete process.env.AGENT_OS_TEST_ADMIN_KEY_SHA256;
        assert.equal((await fetch(api + '/auth/test-admin')).status, 404);
        assert.equal((await request('/auth/test-admin', 'POST', { key })).status, 404);
        process.env.AGENT_OS_TEST_ADMIN_KEY_SHA256 = createHash('sha256').update(key).digest('hex');
        assert.equal((await fetch(api + '/auth/test-admin')).status, 200);
        assert.equal((await request('/auth/test-admin', 'POST', { key: randomBytes(32).toString('hex') })).status, 401);
        const login = await request('/auth/test-admin', 'POST', { key });
        assert.equal(login.status, 200);
        const { lobby, token } = await login.json();
        const path = `/lobbies/${lobby.lobby_id}`;
        assert.equal((await request(path, 'PATCH', { name: 'Test admin can manage' }, token)).status, 200);
        assert.equal((await request(path, 'PATCH', { visibility: 'public' }, token)).status, 403);
        const otherLobby = (await server.store.listLobbies()).find((entry) => entry.visibility === 'public')!;
        assert.equal((await request(`/lobbies/${otherLobby.lobby_id}`, 'PATCH', { status: 'closed' }, token)).status, 401);
        assert.equal((await request('/lobbies', 'POST', { auth_lobby_id: lobby.lobby_id, visibility: 'private' }, token)).status, 403);
        const admin = new LobbyClient({
          lobbyUrl, lobbyId: lobby.lobby_id, reconnect: false, heartbeatMs: 0,
          register: { type: 'lobby-register', display_name: 'Test admin', participant_type: 'human', join_token: token },
        });
        clients.push(admin);
        const registered = waitForMessage(admin, (message) => message.type === 'lobby-registered');
        await admin.connect();
        await registered;
        const delivered = waitForMessage(admin, (message) => message.type === 'lobby-message-received');
        admin.send({ type: 'lobby-message', to_agent_id: 'all', message_type: 'chat', content: 'Test admin can coordinate' });
        await delivered;
        admin.close();
        process.env.NODE_ENV = 'production';
        assert.equal((await fetch(api + '/auth/test-admin')).status, 404);
        assert.equal((await request('/auth/test-admin', 'POST', { key })).status, 404);
        assert.equal((await request(path, 'PATCH', { status: 'closed' }, token)).status, 401);
      } finally {
        if (oldMode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = oldMode;
        if (oldDigest === undefined) delete process.env.AGENT_OS_TEST_ADMIN_KEY_SHA256;
        else process.env.AGENT_OS_TEST_ADMIN_KEY_SHA256 = oldDigest;
      }
    });

    await check('live test admin can send commands only in the configured lobby before expiry', async () => {
      const lobby = { ...makeLobby('public'), created_by: 'live-qa-owner' };
      const other = { ...makeLobby('private'), created_by: 'other-qa-owner' };
      await server.store.createLobby(lobby);
      await server.store.createLobby(other);
      const key = randomBytes(32).toString('hex');
      const digest = createHash('sha256').update(key).digest('hex');
      const oldMode = process.env.NODE_ENV;
      const oldConfig = process.env.AGENT_OS_LIVE_TEST_ADMIN;
      const api = `${lobbyUrl}/api/v1/agent-lobby`;
      const post = (path: string, body: unknown, token?: string) => fetch(api + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const send = (target: LobbySession, token: string) =>
        post(`/lobbies/${target.lobby_id}/messages`, { content: 'Live QA fixture' }, token);
      try {
        process.env.NODE_ENV = 'production';
        process.env.AGENT_OS_LIVE_TEST_ADMIN = `${lobby.lobby_id}:${digest}:${Date.now() + 60_000}`;
        assert.equal((await post('/auth/test-admin', { key: randomBytes(32).toString('hex') })).status, 401);
        const login = await post('/auth/test-admin', { key });
        assert.equal(login.status, 200);
        const { token } = await login.json();
        assert.equal((await send(other, token)).status, 401);
        const allowed = await send(lobby, token);
        assert.equal(allowed.status, 201);
        assert.equal((await allowed.json()).message.from_agent_id, 'LobbyOwner');
        assert.equal((await server.store.getLobby(lobby.lobby_id))?.created_by, lobby.created_by);
        process.env.AGENT_OS_LIVE_TEST_ADMIN = `all:${digest}:${Date.now() + 60_000}`;
        const privateLogin = await post('/auth/test-admin', { key, lobby_id: other.lobby_id });
        assert.equal(privateLogin.status, 200);
        const privateSession = await privateLogin.json();
        assert.ok(privateSession.lobbies.some((entry: LobbySession) => entry.lobby_id === other.lobby_id));
        assert.equal((await send(other, privateSession.token)).status, 201);
        assert.equal((await send(lobby, privateSession.token)).status, 401);
        const operator = new LobbyClient({
          lobbyUrl, lobbyId: other.lobby_id, reconnect: false, heartbeatMs: 0,
          register: { type: 'lobby-register', display_name: 'QA operator', participant_type: 'human', join_token: privateSession.token },
        });
        clients.push(operator);
        const joined = waitForMessage(operator, message => message.type === 'lobby-registered');
        await operator.connect();
        await joined;
        operator.close();
        process.env.AGENT_OS_LIVE_TEST_ADMIN = `all:${digest}:${Date.now() - 1}`;
        assert.equal((await post('/auth/test-admin', { key })).status, 404);
        assert.equal((await send(lobby, token)).status, 401);
        assert.equal((await send(other, privateSession.token)).status, 401);
      } finally {
        if (oldMode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = oldMode;
        if (oldConfig === undefined) delete process.env.AGENT_OS_LIVE_TEST_ADMIN;
        else process.env.AGENT_OS_LIVE_TEST_ADMIN = oldConfig;
      }
    });

    await check('the event log is queryable over HTTP', async () => {
      const lobby = (await (await fetch(new URL('/api/v1/agent-lobby/discover', lobbyUrl))).json()) as { lobby: { lobby_id: string } };
      const events = (await (await fetch(new URL(`/api/v1/agent-lobby/lobbies/${lobby.lobby.lobby_id}/events`, lobbyUrl))).json()) as { events: unknown[] };
      assert.ok(Array.isArray(events.events) && events.events.length > 0);
    });

    // ════════ Part C — Swarm lobby extensions (Task 13) ════════
    console.log('\nPart C — Swarm extensions & integrations (Task 13)');

    await check('NONCE SECURITY: binds to lobby, rejects replay, expiry, and cross-lobby reuse', async () => {
      const store = new InMemoryLobbyStore();
      const { generateNonceChallenge, verifyProofAndIssueToken } = await import('../../packages/lobby-server/src/auth/identityProof.js');
      
      // Expired nonce
      const expiredChallenge = await generateNonceChallenge('did:ccd:agent-001', 'lobby-A', store);
      expiredChallenge.expiresAt = Date.now() - 1000;
      await store.saveNonce('did:ccd:agent-001', 'lobby-A', expiredChallenge.nonce, expiredChallenge.expiresAt);
      const expiredToken = await verifyProofAndIssueToken('did:ccd:agent-001', `valid_sig_for_${expiredChallenge.nonce}`, 'MOCK_PUBLIC_KEY_PEM_001', 'lobby-A', store);
      assert.equal(expiredToken, null, 'expired nonce must be rejected');

      // Valid challenge
      const challenge = await generateNonceChallenge('did:ccd:agent-001', 'lobby-A', store);
      assert.ok(challenge.nonce);

      // Reused nonce
      const token = await verifyProofAndIssueToken('did:ccd:agent-001', `valid_sig_for_${challenge.nonce}`, 'MOCK_PUBLIC_KEY_PEM_001', 'lobby-A', store);
      assert.ok(token);

      const tokenReplay = await verifyProofAndIssueToken('did:ccd:agent-001', `valid_sig_for_${challenge.nonce}`, 'MOCK_PUBLIC_KEY_PEM_001', 'lobby-A', store);
      assert.equal(tokenReplay, null, 'replayed nonce must be rejected');

      // Cross-lobby reuse
      const challenge2 = await generateNonceChallenge('did:ccd:agent-001', 'lobby-A', store);
      const crossToken = await verifyProofAndIssueToken('did:ccd:agent-001', `valid_sig_for_${challenge2.nonce}`, 'MOCK_PUBLIC_KEY_PEM_001', 'lobby-B', store);
      assert.equal(crossToken, null, 'nonce for Lobby A cannot issue token for Lobby B');
    });

    await check('PRIVATE JOIN POLICY: private lobbies reject unauthorized, expired, or revoked joins', async () => {
      const store = new InMemoryLobbyStore();
      const lobby = makeLobby('private');
      await store.createLobby(lobby);

      const { verifyLobbyJoinPolicy } = await import('../../packages/lobby-server/src/auth/joinPolicy.js');
      const { generateNonceChallenge, verifyProofAndIssueToken } = await import('../../packages/lobby-server/src/auth/identityProof.js');
      
      // Missing token
      const r1 = await verifyLobbyJoinPolicy(lobby.lobby_id, undefined, store);
      assert.equal(r1.allowed, false);

      // Valid token but not a member
      const challenge = await generateNonceChallenge('did:ccd:uninvited', lobby.lobby_id, store);
      const token = await verifyProofAndIssueToken('did:ccd:uninvited', `valid_sig_for_${challenge.nonce}`, 'MOCK_PUBLIC_KEY_PEM_001', lobby.lobby_id, store);
      const r2 = await verifyLobbyJoinPolicy(lobby.lobby_id, token!, store);
      assert.equal(r2.allowed, false, 'must reject non-member');

      // Add revoked member
      await store.addMember({
        id: 'member_revoked',
        lobby_id: lobby.lobby_id,
        identity_ref: 'did:ccd:revoked-001',
        role: 'contributor',
        status: 'revoked'
      });
      const challenge3 = await generateNonceChallenge('did:ccd:revoked-001', lobby.lobby_id, store);
      const token3 = await verifyProofAndIssueToken('did:ccd:revoked-001', `valid_sig_for_${challenge3.nonce}`, 'MOCK_PUBLIC_KEY_PEM_001', lobby.lobby_id, store);
      const r3 = await verifyLobbyJoinPolicy(lobby.lobby_id, token3!, store);
      assert.equal(r3.allowed, false, 'must reject revoked member');
    });

    await check('MESSAGE REVOCATION: revoked members are rejected during messaging', async () => {
      const store = new InMemoryLobbyStore();
      const lobby = makeLobby('private');
      lobby.join_policy = 'registered';
      await store.createLobby(lobby);

      const coord = new LobbyCoordinator(store);
      const conn = { connId: 'conn_1', lobbyId: lobby.lobby_id, orgId: 'default' };
      
      // Add Alice as active member first
      await store.addMember({
        id: 'alice',
        lobby_id: lobby.lobby_id,
        identity_ref: 'did:ccd:alice',
        role: 'contributor',
        status: 'active'
      });

      // Register Alice with identity ref
      const { generateNonceChallenge, verifyProofAndIssueToken } = await import('../../packages/lobby-server/src/auth/identityProof.js');
      const challenge = await generateNonceChallenge('did:ccd:alice', lobby.lobby_id, store);
      const token = await verifyProofAndIssueToken('did:ccd:alice', `valid_sig_for_${challenge.nonce}`, 'MOCK_PUBLIC_KEY_PEM_001', lobby.lobby_id, store);
      
      const registerRes = await coord.handle(conn, {
        type: 'lobby-register',
        display_name: 'Alice',
        participant_type: 'human',
        join_token: token!
      });
      assert.ok(!registerRes.close, 'Alice registered');
      assert.ok(conn.agentId);

      // Verify Alice can send a message
      const msgRes1 = await coord.handle(conn, {
        type: 'lobby-message',
        to_agent_id: 'all',
        message_type: 'chat',
        content: 'hello'
      });
      assert.ok(msgRes1.out.some(o => o.message.type === 'lobby-message-received'), 'message received when active');

      // Revoke Alice
      await store.addMember({
        id: 'alice',
        lobby_id: lobby.lobby_id,
        identity_ref: 'did:ccd:alice',
        role: 'contributor',
        status: 'revoked'
      });

      // Alice tries sending a message again
      const msgRes2 = await coord.handle(conn, {
        type: 'lobby-message',
        to_agent_id: 'all',
        message_type: 'chat',
        content: 'hello again'
      });
      assert.ok(msgRes2.close, 'Alice must be disconnected/closed');
      assert.ok(msgRes2.out.some(o => o.message.type === 'lobby-error'), 'Alice gets a membership error');
    });

    await check('SECRET HYGIENE: encrypt and decrypt secrets, redact logs and GCM payloads', async () => {
      const store = new InMemoryLobbyStore();
      const { saveIntegrationSecret, getDecryptedSecret, redactLogs } = await import('../../packages/lobby-server/src/integrations/githubApp.js');
      
      const lobby = makeLobby('private');
      await store.createLobby(lobby);

      const { installSlackIntegration } = await import('../../packages/lobby-server/src/integrations/slackApp.js');
      const integration = await installSlackIntegration({
        lobbyId: lobby.lobby_id,
        userId: 'user-alice',
        teamId: 'team-T123',
        teamName: 'Workspace',
        botToken: 'xoxb-secret-token-123',
        scopes: ['chat:write']
      }, store);

      assert.equal(integration.status, 'active');

      // Decrypt
      const decrypted = await getDecryptedSecret(lobby.lobby_id, 'slack', 'bot_token', store);
      assert.equal(decrypted, 'xoxb-secret-token-123', 'decryption must restore plaintext');

      // Logs redaction including raw secrets and GCM ciphertexts
      const dirtyLog = 'Error connecting with token xoxb-secret-token-123 and secret ghs_tempKey123 and payload 1a2b3c4d5e6f7a8b9c0d1e2f:112233445566778899001122:aabbccddeeff00112233445566778899';
      const cleanLog = redactLogs(dirtyLog);
      assert.ok(!cleanLog.includes('xoxb-secret-token-123'));
      assert.ok(!cleanLog.includes('ghs_tempKey123'));
      assert.ok(cleanLog.includes('ENC-REDACTED'), 'GCM payload must be redacted');
    });

    await check('SLACK RELAY: validates, dedupes, routes tasks to floor, and enforces role gates', async () => {
      const store = new InMemoryLobbyStore();
      const lobbyPrivate = makeLobby('private');
      await store.createLobby(lobbyPrivate);

      const lobbyPublic = makeLobby('public');
      await store.createLobby(lobbyPublic);

      const { handleSlackCommand } = await import('../../packages/slack-relay/src/commands.js');

      // Link identity for Alice (Admin) and Bob (Contributor)
      await store.linkExternalIdentity({
        id: 'link_alice',
        provider: 'slack',
        external_team_id: 'team-1',
        external_user_id: 'slack-alice',
        identity_ref: 'did:ccd:alice',
        verified_at: new Date().toISOString()
      });
      await store.addMember({
        id: 'member_alice',
        lobby_id: lobbyPrivate.lobby_id,
        identity_ref: 'did:ccd:alice',
        role: 'admin',
        status: 'active'
      });

      await store.linkExternalIdentity({
        id: 'link_bob',
        provider: 'slack',
        external_team_id: 'team-1',
        external_user_id: 'slack-bob',
        identity_ref: 'did:ccd:bob',
        verified_at: new Date().toISOString()
      });
      await store.addMember({
        id: 'member_bob',
        lobby_id: lobbyPrivate.lobby_id,
        identity_ref: 'did:ccd:bob',
        role: 'contributor',
        status: 'active'
      });

      let sentMsg: LobbyMessage | null = null;
      const sendMock = async (_lobbyId: string, msg: LobbyMessage) => {
        sentMsg = msg;
      };

      // 1. Unlinked Slack command is rejected in private lobby
      const r1 = await handleSlackCommand({
        command: '/swarm',
        text: 'status',
        user_id: 'slack-unlinked',
        team_id: 'team-1',
        channel_id: 'chan-1',
        response_url: 'http://post'
      }, lobbyPrivate.lobby_id, store, sendMock);
      assert.match(r1.text, /not linked/i);

      // 2. Status works for linked member in private lobby
      const r2 = await handleSlackCommand({
        command: '/swarm',
        text: 'status',
        user_id: 'slack-alice',
        team_id: 'team-1',
        channel_id: 'chan-1',
        response_url: 'http://post'
      }, lobbyPrivate.lobby_id, store, sendMock);
      assert.match(r2.text, /Swarm Status/i);

      // 3. Status in public lobbies works even for unlinked Slack users
      const r3 = await handleSlackCommand({
        command: '/swarm',
        text: 'status',
        user_id: 'slack-unlinked',
        team_id: 'team-1',
        channel_id: 'chan-1',
        response_url: 'http://post'
      }, lobbyPublic.lobby_id, store, sendMock);
      assert.match(r3.text, /Swarm Status/i);

      // 4. Task creation by contributor (Bob) in private lobby is rejected on role check
      const r4 = await handleSlackCommand({
        command: '/swarm',
        text: 'task implement database index',
        user_id: 'slack-bob',
        team_id: 'team-1',
        channel_id: 'chan-1',
        response_url: 'http://post'
      }, lobbyPrivate.lobby_id, store, sendMock);
      assert.match(r4.text, /Insufficient role permissions/i);

      // 5. Task creation by admin (Alice) in private lobby succeeds and routes to Boss Agent floor queue
      const r5 = await handleSlackCommand({
        command: '/swarm',
        text: 'task implement database index',
        user_id: 'slack-alice',
        team_id: 'team-1',
        channel_id: 'chan-1',
        response_url: 'http://post'
      }, lobbyPrivate.lobby_id, store, sendMock);
      assert.match(r5.text, /Queuing task spec to Boss Agent/i);
      assert.ok(sentMsg);
      assert.equal(sentMsg.message_type, 'chat', 'routes as chat message to Boss Agent floor');
      assert.equal(sentMsg.content, 'implement database index');
    });

    await check('KB SYNC: handles size limits, mime checks, failed conversion atomicity, and writes provenance', async () => {
      const store = new InMemoryLobbyStore();
      const lobby = makeLobby('private');
      await store.createLobby(lobby);

      const { resolve } = await import('node:path');
      const { tmpdir } = await import('node:os');
      const { mkdtemp, readFile } = await import('node:fs/promises');
      const tempRepo = await mkdtemp(resolve(tmpdir(), 'kb-repo-'));

      await store.upsertKnowledgeBase({
        lobby_id: lobby.lobby_id,
        repository_url: 'https://github.com/mock/kb.git',
        branch: 'main',
        kb_root_path: tempRepo,
        latest_commit_sha: 'none',
        last_synced_at: new Date().toISOString()
      });

      const { processKnowledgeSyncJob } = await import('../../packages/lobby-server/src/kb/jobs.js');

      // 1. Oversized file check
      await store.upsertKnowledgeSyncJob({
        id: 'job_oversized',
        lobby_id: lobby.lobby_id,
        kb_id: 'kb_1',
        source_provider: 'upload',
        status: 'pending',
        error: '',
        created_by_identity_ref: 'did:ccd:alice',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      const hugeBuffer = Buffer.alloc(51 * 1024 * 1024); // 51MB
      const r1 = await processKnowledgeSyncJob('job_oversized', hugeBuffer, 'huge.pdf', 'application/pdf', store);
      assert.equal(r1.status, 'failed');
      assert.match(r1.error || '', /exceeds maximum size/i);

      // 2. Bad MIME type check
      await store.upsertKnowledgeSyncJob({
        id: 'job_bad_mime',
        lobby_id: lobby.lobby_id,
        kb_id: 'kb_1',
        source_provider: 'upload',
        status: 'pending',
        error: '',
        created_by_identity_ref: 'did:ccd:alice',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      const r2 = await processKnowledgeSyncJob('job_bad_mime', Buffer.from('data'), 'malicious.exe', 'application/octet-stream', store);
      assert.equal(r2.status, 'failed');
      assert.match(r2.error || '', /MIME type/i);

      // 3. Successful conversion & Git provenance content checks
      await store.upsertKnowledgeSyncJob({
        id: 'job_success',
        lobby_id: lobby.lobby_id,
        kb_id: 'kb_1',
        source_provider: 'upload',
        status: 'pending',
        error: '',
        created_by_identity_ref: 'did:ccd:alice',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      const docBuffer = Buffer.from('# Documentation Title\n\nActive swarm concepts [[Concept X]] details.');
      const r3 = await processKnowledgeSyncJob('job_success', docBuffer, 'guide.md', 'text/markdown', store);
      assert.equal(r3.status, 'committed');

      // Verify files written to disk inside the repository folder
      const manifest = JSON.parse(await readFile(resolve(tempRepo, 'kb-manifest.json'), 'utf8'));
      assert.ok(manifest.files.some((f: any) => f.name === 'guide.md'));

      const graph = JSON.parse(await readFile(resolve(tempRepo, 'graph-snapshot.json'), 'utf8'));
      assert.ok(graph.nodes.some((n: any) => n.label === 'Concept X'));

      const chunks = JSON.parse(await readFile(resolve(tempRepo, 'chunks-index.json'), 'utf8'));
      assert.ok(chunks.length > 0);

      const provenance = JSON.parse(await readFile(resolve(tempRepo, 'provenance-metadata.json'), 'utf8'));
      assert.equal(provenance.job_id, 'job_success');
      assert.equal(provenance.actor_ref, 'did:ccd:alice');
      assert.equal(provenance.lobby_id, lobby.lobby_id);
    });

    await check('MARKETPLACE: handles posting tasks, bidding with verified DIDs, trust chains, assigning, and settlements', async () => {
      // 1. Create a custom store and mock verifier
      const mockStore = new InMemoryLobbyStore();
      
      // Setup mock verifier
      const mockVerifyIdentity = async (ref: string) => {
        if (ref === 'did:ccd:untrusted-agent') {
          return {
            status: 'registry_verified' as const,
            ref: { did: ref, network: 'testnet' as const },
            source: 'indexer' as const,
            checkedAt: new Date().toISOString(),
            issuerDid: 'did:ccd:untrusted-issuer' // not registered as issuer!
          };
        }
        return {
          status: 'registry_verified' as const,
          ref: { did: ref, network: 'testnet' as const },
          source: 'indexer' as const,
          checkedAt: new Date().toISOString(),
          issuerDid: 'did:ccd:trusted-human' // registered!
        };
      };

      const mockCoord = new LobbyCoordinator(mockStore, { verifyIdentity: mockVerifyIdentity });
      const testServer = await startLobbyServer({ port: 4749, store: mockStore, coordinator: mockCoord, autoDefaultLobby: false });
      const testLobbyUrl = `http://localhost:${testServer.port}`;

      try {
        const lobby = { ...makeLobby('private'), created_by: 'did:ccd:bob' };
        await mockStore.createLobby(lobby);
        const marketplaceHeaders = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${issueSessionToken(lobby.created_by, lobby.lobby_id)}`,
        };

        // Register human issuer in mock store
        await mockStore.registerIssuer({
          issuer_did: 'did:ccd:trusted-human',
          identity_ref: 'human-ronni',
          registered_at: new Date().toISOString(),
          revoked: false
        });

        // 1. Post a task
        const postRes = await fetch(`${testLobbyUrl}/api/v1/agent-lobby/lobbies/${lobby.lobby_id}/tasks`, {
          method: 'POST',
          headers: marketplaceHeaders,
          body: JSON.stringify({
            title: 'Write custom parser',
            description: 'Implement a TS AST model parser',
            proposed_budget_ccd: 1000,
            posted_by_identity_ref: 'did:ccd:bob'
          })
        });
        assert.equal(postRes.status, 201);
        const { task } = await postRes.json();
        assert.equal(task.title, 'Write custom parser');
        assert.equal(task.proposed_budget_ccd, 1000);
        assert.equal(task.status, 'posted');

        // 2. Try to bid with an untrusted issuer -> Rejected (401)
        const badBidRes = await fetch(`${testLobbyUrl}/api/v1/agent-lobby/lobbies/${lobby.lobby_id}/tasks/${task.id}/bid`, {
          method: 'POST',
          headers: marketplaceHeaders,
          body: JSON.stringify({
            agent_did: 'did:ccd:untrusted-agent',
            bidder_identity_ref: 'agent-identity-1'
          })
        });
        assert.equal(badBidRes.status, 401);
        const badBidErr = await badBidRes.json();
        assert.match(badBidErr.error, /issuer is not registered/i);

        // 3. Bid with a trusted human issuer -> Accepted (201)
        const goodBidRes = await fetch(`${testLobbyUrl}/api/v1/agent-lobby/lobbies/${lobby.lobby_id}/tasks/${task.id}/bid`, {
          method: 'POST',
          headers: marketplaceHeaders,
          body: JSON.stringify({
            agent_did: 'did:ccd:trusted-agent',
            bidder_identity_ref: 'agent-identity-2'
          })
        });
        assert.equal(goodBidRes.status, 201);
        const { bid } = await goodBidRes.json();
        assert.equal(bid.agent_did, 'did:ccd:trusted-agent');

        // Verify task status updated to 'bidded'
        const updatedTask = await mockStore.getMarketplaceTask(lobby.lobby_id, task.id);
        assert.equal(updatedTask?.status, 'bidded');

        // 4. Assign task
        const assignRes = await fetch(`${testLobbyUrl}/api/v1/agent-lobby/lobbies/${lobby.lobby_id}/tasks/${task.id}/assign`, {
          method: 'POST',
          headers: marketplaceHeaders,
          body: JSON.stringify({
            assigned_agent_id: 'did:ccd:trusted-agent',
            assigned_agent_ref: 'agent-identity-2'
          })
        });
        assert.equal(assignRes.status, 200);
        const assignData = await assignRes.json();
        assert.equal(assignData.task.status, 'assigned');
        assert.equal(assignData.task.assigned_agent_id, 'did:ccd:trusted-agent');

        // 5. Complete task & record payment Tx
        const completeRes = await fetch(`${testLobbyUrl}/api/v1/agent-lobby/lobbies/${lobby.lobby_id}/tasks/${task.id}/complete`, {
          method: 'POST',
          headers: marketplaceHeaders,
          body: JSON.stringify({
            tx_hash: '0xabc1239999'
          })
        });
        assert.equal(completeRes.status, 200);
        const completeData = await completeRes.json();
        assert.equal(completeData.task.status, 'completed');
        assert.equal(completeData.task.tx_hash, '0xabc1239999');

      } finally {
        await testServer.close();
      }
    });

  } finally {
    for (const c of clients) c.close();
    await server.close();
    await rm(wireDirectory, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('verify-lobby: all checks passed ✓');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
