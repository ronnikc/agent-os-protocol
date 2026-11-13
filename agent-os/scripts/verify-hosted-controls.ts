// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { LobbyTask, WorkspaceAdapter } from '@agent-os/protocol-core';
import { issueSessionToken } from '../../packages/lobby-server/src/auth/identityProof.js';
import { HostedControls } from '../../packages/lobby-server/src/hosted/hosted-controls.js';
import { hostedModelBudget } from '../../packages/lobby-server/src/hosted/model-budget.js';
import { HostedAgentRunner } from '../../packages/lobby-server/src/hosted/hosted-agent-runner.js';
import { createApiRuntimeAdapter } from '../../packages/adapters/src/api-runtime.js';
import { startLobbyServer, type RunningLobbyServer } from '../../packages/lobby-server/src/server.js';
import { InMemoryLobbyStore } from '../../packages/lobby-server/src/store.js';
import { workspaceAccountVerifier } from '../../packages/lobby-server/src/hosted/workspace-account.js';
import { WorkspaceAllocationRecovery } from '../../packages/lobby-server/src/hosted/workspace-allocation.js';

const policy = { workspaceEnabled: true, periodHours: 1, modelPerRun: 5000, modelPerPeriod: 5000,
  computePerRun: 100, computePerPeriod: 100, concurrency: 4, deadlineMs: 30_000 };

export async function verifyHostedControls() {
  const signal = new AbortController().signal;
  const uncertain = new WorkspaceAllocationRecovery({
    read: () => ({ createRequestedAt: 1 }),
    beginCreate: () => false,
    bind: () => assert.fail('No allocation was discovered'),
  }, {
    find: async () => undefined,
    create: async () => assert.fail('Do not repeat an uncertain create'),
    remove: async () => assert.fail('No allocation was discovered'),
    confirmAbsent: async () => false,
  });
  await assert.rejects(uncertain.provision(signal), /has not been confirmed/);
  assert.deepEqual(await uncertain.destroy(signal), { confirmed: false });
  for (const [provider, url, header, value] of [
    ['e2b', 'https://api.e2b.app/v2/sandboxes?limit=1', 'X-API-Key', 'owner-key'],
    ['agent37', 'https://api.agent37.com/v1/instances', 'Authorization', 'Bearer owner-key'],
  ] as const) {
    const verify = workspaceAccountVerifier(provider, async (input, init) => {
      assert.equal(input, url);
      assert.equal(init?.method, 'GET');
      assert.equal(new Headers(init?.headers).get(header), value);
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.signal, signal);
      return new Response(null, { status: 200 });
    });
    await verify!('owner-key', signal);
  }
  const dir = await mkdtemp(join(tmpdir(), 'agent-os-hosted-'));
  const file = join(dir, 'store.json');
  const previousKey = process.env.AGENT_OS_SECRET_ENCRYPTION_KEY;
  process.env.AGENT_OS_SECRET_ENCRYPTION_KEY = 'fake-workspace-test-master-key';
  const credential = 'test-workspace-token-ABC123';
  const allocations = new Set<string>();
  const provisionCalls: string[] = [];
  let actual: number | undefined;
  let failCleanup = true;
  let waitForCancel = false;
  let failProvision = true;
  const adapter: WorkspaceAdapter = {
    capabilities: {
      provider: 'e2b', deletion: 'confirmed', credentials: 'control-plane-only', usage: 'final-or-pending',
      profiles: [{ id: 'small', cpu: 1, memoryMiB: 256, diskMiB: 256, isolation: 'microvm',
        egress: 'none', regions: ['fake-region'], maxRuntimeMs: 30_000 }],
    },
    async verifyConnection(token) {
      if (token !== credential) throw new Error('Provider rejected ' + token);
    },
    estimate: () => 100,
    async provision(key, attempt, token, signal, journal) {
      assert.equal(token, credential);
      assert.equal(attempt.sourceRevision, 'a'.repeat(40));
      provisionCalls.push(key);
      await new WorkspaceAllocationRecovery(journal, operations(key)).provision(signal);
    },
    async wait(_, __, signal) {
      if (waitForCancel) await delay(30_000, undefined, { signal });
    },
    async collect() { return { tests: 'passed', logs: 'redact ' + credential }; },
    async destroy(key, _, signal, journal) {
      return new WorkspaceAllocationRecovery(journal, operations(key)).destroy(signal);
    },
  };
  function operations(key: string) {
    return {
      async create() {
        assert.ok(!allocations.has(key), 'Attempt must never issue a second create');
        allocations.add(key);
        if (failProvision) {
          failProvision = false;
          throw new Error('Provider allocated but lost the response');
        }
        return key;
      },
      async find() { return allocations.has(key) ? key : undefined; },
      async remove(id: string) {
        assert.equal(id, key);
        if (failCleanup) return { confirmed: false };
        allocations.delete(id);
        return { confirmed: true, actual };
      },
      async confirmAbsent() { return false; },
    };
  }

  let server: RunningLobbyServer | undefined;
  let controls: HostedControls | undefined;
  const openServer = (store: InMemoryLobbyStore) =>
    startLobbyServer({ port: 0, store, autoDefaultLobby: false, workspaceAdapters: [adapter] });
  async function call(lobby: string, path: string, method = 'GET', body?: unknown, actor = 'owner-' + lobby, tokenLobby = lobby) {
    const port = (server!.httpServer.address() as AddressInfo).port;
    const response = await fetch('http://127.0.0.1:' + port + '/api/v1/agent-lobby/lobbies/' + lobby + path, {
      method,
      headers: { authorization: 'Bearer ' + issueSessionToken(actor, tokenLobby), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  async function until<T>(read: () => T | undefined): Promise<T> {
    for (let i = 0; i < 120; i++) {
      const value = read();
      if (value !== undefined) return value;
      await delay(15);
    }
    throw new Error('Timed out waiting for hosted state');
  }

  try {
    let store = new InMemoryLobbyStore(file);
    const now = new Date().toISOString();
    for (const lobby of ['a', 'b']) {
      await store.createLobby({ lobby_id: lobby, org_id: 'default', name: lobby, status: 'active', visibility: 'private',
        connected_agent_ids: [], message_seq: 0, created_at: now, updated_at: now, created_by: 'owner-' + lobby });
      const task: LobbyTask = { lobby_id: lobby, task_id: 'task-' + lobby, org_id: 'default', title: 'Fake workspace',
        description: 'Verify task binding', priority: 'normal', category: 'general', status: 'assigned',
        assigned_to: 'fake', assigned_by: 'owner-' + lobby, assigned_at: now };
      await store.upsertTask(task);
    }
    server = await openServer(store);
    assert.equal((await call('a', '/hosted-controls', 'PUT', policy, 'observer')).status, 403);
    assert.equal((await call('a', '/hosted-controls', 'PUT', policy, 'owner-b', 'b')).status, 401);
    assert.equal((await call('a', '/hosted-controls', 'PUT', { ...policy, concurrency: 0 })).status, 400);
    assert.equal((await call('a', '/hosted-controls', 'PUT', policy)).status, 200);
    assert.equal((await call('b', '/hosted-controls', 'PUT', policy)).status, 200);
    const provider = '/integrations/cloud-workspaces/e2b';
    const connect = await call('a', provider, 'POST', { action: 'connect', credential });
    assert.equal(connect.status, 200);
    assert.equal(connect.body.connections[0].hint, '••••C123');
    assert.equal(connect.body.providers[0].capabilities.profiles[0].egress, 'none');
    assert.ok(!JSON.stringify(connect.body).includes(credential));
    assert.equal((await call('a', provider, 'POST', { action: 'verify' }, 'observer')).status, 403);
    assert.deepEqual((await call('a', provider, 'POST', { action: 'verify' })).body, { verified: true });
    const invalid = 'invalid-owner-credential';
    assert.equal((await call('b', provider, 'POST', { action: 'connect', credential: invalid })).status, 200);
    const denied = await call('b', provider, 'POST', { action: 'verify' });
    assert.equal(denied.status, 422);
    assert.ok(!JSON.stringify(denied.body).includes(invalid));
    const request = { taskId: 'task-a', attemptId: 'first', connectionId: connect.body.connections[0].id,
      sourceRevision: 'a'.repeat(40), profileId: 'small', region: 'fake-region' };
    assert.equal((await call('b', '/hosted-runs', 'POST', { ...request, taskId: 'task-b' })).status, 404);
    assert.equal((await call('a', '/hosted-runs', 'POST', { ...request, taskId: 'task-b' })).status, 404);
    assert.equal((await call('a', '/hosted-runs', 'POST', { ...request, region: 'unapproved' })).status, 400);
    const simultaneous = await Promise.all(['first', 'second'].map(attemptId =>
      call('a', '/hosted-runs', 'POST', { ...request, attemptId })));
    assert.deepEqual(simultaneous.map(reply => reply.status).sort(), [202, 409]);
    const run = simultaneous.find(reply => reply.status === 202)!.body.run;
    assert.equal((await call('a', '/hosted-runs', 'POST', { ...request, attemptId: run.attempt.attemptId })).body.run.id, run.id);
    assert.equal(store.readHostedState('a').runs[0].state, 'provisioning');
    assert.ok(store.readHostedState('a').runs[0].allocation?.createRequestedAt);
    assert.equal((await call('b', '/hosted-runs/' + run.id, 'DELETE')).status, 404);
    assert.equal((await call('a', provider, 'POST', { action: 'rotate', credential })).status, 409);
    assert.ok(!(await readFile(file, 'utf8')).includes(credential));

    await server.close();
    store = new InMemoryLobbyStore(file);
    server = await openServer(store);
    await until(() => store.readHostedState('a').runs[0].state === 'succeeded' ? true : undefined);
    assert.deepEqual(provisionCalls, [run.id, run.id]);
    assert.equal(store.readHostedState('a').runs[0].allocation?.providerId, run.id);
    assert.equal(allocations.size, 1);
    assert.equal(store.readHostedState('a').runs[0].artifacts?.logs, 'redact [redacted]');
    assert.equal(store.readHostedState('a').runs[0].cleanup, 'pending');

    await server.close();
    failCleanup = false;
    store = new InMemoryLobbyStore(file);
    server = await openServer(store);
    await until(() => store.readHostedState('a').runs[0].cleanup === 'confirmed' ? true : undefined);
    assert.equal(allocations.size, 0);
    assert.equal(store.readHostedState('a').runs[0].usage[0].actual, undefined);
    assert.equal((await call('a', '/hosted-runs', 'POST', { ...request, attemptId: 'unknown-bill' })).status, 409);
    actual = 20;
    assert.equal((await call('a', '/hosted-runs/recover', 'POST')).status, 202);
    await until(() => store.readHostedState('a').runs[0].usage[0].actual === 20 ? true : undefined);
    assert.equal((await call('a', '/hosted-controls', 'PUT', { ...policy, computePerPeriod: 120 })).status, 200);

    waitForCancel = true;
    const second = await call('a', '/hosted-runs', 'POST', { ...request, attemptId: 'cancel-me' });
    assert.equal(second.status, 202);
    assert.equal((await call('a', '/hosted-runs/' + second.body.run.id, 'DELETE')).status, 202);
    await until(() => store.readHostedState('a').runs[1].cleanup === 'confirmed' ? true : undefined);
    assert.equal(store.readHostedState('a').runs[1].state, 'cancelled');
    assert.ok(store.readHostedState('a').audit.some(e => e.action === 'hosted_run_cancelled' && e.actor === 'owner-a'));
    assert.equal((await call('a', '/hosted-runs/audit', 'GET', undefined, 'observer')).status, 403);
    const audit = await call('a', '/hosted-runs/audit?limit=100');
    assert.ok(audit.body.data.some((e: { action: string }) => e.action === 'hosted_run_cancelled'));
    const page = await call('a', '/hosted-runs?offset=1&limit=1');
    assert.equal(page.body.total, 2);
    assert.equal(page.body.data[0].id, run.id);
    assert.equal((await call('a', provider, 'POST', { action: 'disable' })).body.connections[0].status, 'pending');
    assert.equal((await call('a', provider, 'POST', { action: 'rotate', credential })).body.connections[0].status, 'active');
    assert.deepEqual((await call('a', provider, 'POST', { action: 'disconnect' })).body.connections, []);
    await server.close();
    server = undefined;

    store = new InMemoryLobbyStore(file);
    controls = new HostedControls(store);
    controls.setPolicy('a', 'owner-a', { ...policy, workspaceEnabled: false, modelPerRun: 2000, modelPerPeriod: 2000, concurrency: 2 });
    const budget = hostedModelBudget(controls, 'a');
    let requests = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fakeFetch: typeof fetch = async (_, init) => {
      requests++;
      assert.equal(JSON.parse(String(init?.body)).max_tokens, 1024);
      await gate;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'finished' }],
        usage: { input_tokens: 42, output_tokens: 8 } }));
    };
    const runner = () => new HostedAgentRunner(createApiRuntimeAdapter({
      provider: { id: 'anthropic-compatible', model: 'fake' }, apiKey: 'fake', fetchFn: fakeFetch, ...budget,
    }), budget);
    const first = runner().respondTo('work');
    try {
      await until(() => requests === 1 ? true : undefined);
      assert.match(await runner().respondTo('parallel work'), /budget exhausted/);
      assert.equal(requests, 1);
    } finally { release(); }
    assert.equal(await first, 'finished');
    assert.equal(store.readHostedState('a').runs.find(r => r.kind === 'model')?.usage[0].actual, 50);

    let cancelledSignal: AbortSignal | null | undefined;
    const waitingRunner = new HostedAgentRunner(createApiRuntimeAdapter({
      provider: { id: 'anthropic-compatible', model: 'fake' }, apiKey: 'fake', ...budget,
      fetchFn: async (_, init) => {
        cancelledSignal = init?.signal;
        await delay(30_000, undefined, { signal: init?.signal ?? undefined });
        throw new Error('unexpected completion');
      },
    }), budget);
    const waiting = waitingRunner.respondTo('cancel').catch(error => error);
    await until(() => cancelledSignal || undefined);
    const cancelled = store.readHostedState('a').runs.at(-1)!;
    controls.cancel('a', cancelled.id, 'owner-a');
    await waiting;
    assert.equal(cancelledSignal!.aborted, true);
    assert.equal(store.readHostedState('a').runs.at(-1)?.usage[0].actual, undefined);
    store.mutateHostedState('a', state => {
      state.runs.find(run => run.id === cancelled.id)!.started -= 7_200_000;
    });
    assert.match(await runner().respondTo('unknown model bill still holds capacity'), /budget exhausted/);

    controls.setPolicy('b', 'owner-b', { ...policy, concurrency: 1, deadlineMs: 80 });
    const timed = controls.runModel('b', 'task-b', async (_, signal) => {
      await delay(30_000, undefined, { signal });
    });
    const timedOut = assert.rejects(timed, /aborted/i);
    await assert.rejects(controls.runModel('b', 'task-b', async () => {}), /concurrency limit/);
    await timedOut;
    assert.equal(store.readHostedState('b').runs.at(-1)?.state, 'failed');
  } finally {
    controls?.close();
    await server?.close();
    await delay(550); // allow the lobby store's legacy queued saves to settle
    if (previousKey === undefined) delete process.env.AGENT_OS_SECRET_ENCRYPTION_KEY;
    else process.env.AGENT_OS_SECRET_ENCRYPTION_KEY = previousKey;
    await rm(dir, { recursive: true, force: true });
  }
}
