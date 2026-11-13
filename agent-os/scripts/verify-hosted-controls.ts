// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
import { GitHubRepoClient } from '../../packages/lobby-server/src/hosted/github-repo-client.js';
import { e2bAllocation } from '../../packages/lobby-server/src/hosted/e2b-allocation.js';
import { connectE2bGuest, createE2bWorkspace } from '../../packages/lobby-server/src/hosted/e2b-workspace.js';
import { agent37Allocation } from '../../packages/lobby-server/src/hosted/agent37-allocation.js';
import { createAgent37Workspace } from '../../packages/lobby-server/src/hosted/agent37-workspace.js';

const policy = { workspaceEnabled: true, periodHours: 1, modelPerRun: 5000, modelPerPeriod: 5000,
  computePerRun: 100, computePerPeriod: 100, concurrency: 4, deadlineMs: 30_000 };

export async function verifyHostedControls() {
  const signal = new AbortController().signal;
  await assert.rejects(connectE2bGuest('sandbox', 'owner-key', signal, {
    async getInfo() { return { allowInternetAccess: true } as Awaited<ReturnType<typeof import('e2b').Sandbox.getInfo>>; },
    async connect() { return assert.fail('Unconfirmed policy must block guest connection'); },
  }), /private workspace policy/);
  let allocation: { createRequestedAt?: number; providerId?: string } = {};
  const journal = {
    deadline: Date.now() + 30_000,
    read: () => ({ ...allocation }),
    beginCreate() {
      if (allocation.createRequestedAt) return false;
      allocation = { createRequestedAt: Date.now() };
      return true;
    },
    bind(providerId: string) { allocation.providerId = providerId; },
  };
  let creates = 0;
  const e2bFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.e2b.app');
    assert.equal(new Headers(init?.headers).get('X-API-Key'), 'owner-key');
    if (init?.method === 'POST') {
      creates++;
      const body = JSON.parse(String(init.body));
      assert.equal(body.allow_internet_access, false);
      assert.equal(body.autoPause, false);
      assert.equal(body.metadata.agent_os_attempt, 'attempt');
      throw new Error('Lost create response');
    }
    if (init?.method === 'GET') {
      assert.equal(url.searchParams.get('metadata'), 'agent_os_attempt=attempt');
      return Response.json([{ sandboxID: 'sandbox', metadata: { agent_os_attempt: 'attempt' } }]);
    }
    assert.equal(url.pathname, '/sandboxes/sandbox');
    return new Response(null, { status: 204 });
  };
  const e2b = () => e2bAllocation('attempt', 'owner-key', journal,
    { templateId: 'fixture', cpu: 2, deadline: Date.now() + 30_000 }, e2bFetch);
  await assert.rejects(e2b().provision(signal), /Lost create response/);
  assert.equal(await e2b().provision(signal), 'sandbox');
  assert.equal(creates, 1);
  assert.deepEqual(await e2b().destroy(signal), { confirmed: true });
  allocation = {};
  const calls: string[] = [];
  const fixturePatch = 'diff --git a/README.md b/README.md\nnew file mode 100644\n--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+updated\n';
  const e2bWorkspace = createE2bWorkspace({
    templateId: 'fixture', command: 'npm test', maxMicrosPerSecond: 5,
    profile: { id: 'fixture', cpu: 2, memoryMiB: 1024, diskMiB: 2048, isolation: 'microvm',
      egress: 'none', regions: ['fixture'], maxRuntimeMs: 30_000 },
  }, async (id, token) => {
    assert.equal(id, 'sandbox');
    assert.equal(token, 'owner-key');
    return {
      async upload(bytes) { assert.deepEqual([...bytes], [1, 2, 3]); calls.push('upload'); },
      async run(command, options) {
        assert.equal(options.signal, signal);
        if (command.includes('git diff --cached')) return { stdout: fixturePatch };
        if (!command.includes('tar --')) assert.match(command, /timeout --kill-after=1s \d+s sh -c/);
        calls.push(command.includes('tar --') ? 'extract' : 'execute');
        assert.ok(!command.includes(token));
      },
      async read(path) { return path.endsWith('/exit') ? '0' : 'test output'; },
    };
  }, async (_, init) => {
    if (init?.method === 'POST') return Response.json({ sandboxID: 'sandbox' }, { status: 201 });
    assert.equal(init?.method, 'DELETE');
    return new Response(null, { status: 204 });
  });
  await e2bWorkspace.provision('attempt', {
    lobbyId: 'fixture', taskId: 'task', attemptId: 'attempt', connectionId: 'e2b', sourceRevision: 'a'.repeat(40),
    profileId: 'fixture', region: 'fixture', deadline: Date.now() + 30_000,
  }, 'owner-key', signal, journal, async () => new Uint8Array([1, 2, 3]));
  await e2bWorkspace.wait('attempt', 'owner-key', signal, journal);
  assert.deepEqual(calls, ['upload', 'extract', 'execute']);
  const e2bArtifacts = await e2bWorkspace.collect('attempt', 'owner-key', signal, journal);
  assert.deepEqual(e2bArtifacts, { exitCode: 0, logs: 'test output', patch: fixturePatch });
  assert.deepEqual(await e2bWorkspace.destroy('attempt', 'owner-key', signal, journal), { confirmed: true });
  const patchRepo = await mkdtemp(join(tmpdir(), 'agent-os-patch-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: patchRepo, encoding: 'utf8' });
    git('init', '-q');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--allow-empty', '-qm', 'pinned source');
    const revision = git('rev-parse', 'HEAD').trim();
    const input = e2bArtifacts.patch!;
    execFileSync('git', ['apply', '--check', '-'], { cwd: patchRepo, input });
    execFileSync('git', ['-c', 'core.autocrlf=false', 'apply', '-'], { cwd: patchRepo, input });
    assert.equal(await readFile(join(patchRepo, 'README.md'), 'utf8'), 'updated\n');
    assert.equal(git('rev-parse', 'HEAD').trim(), revision);
  } finally {
    await rm(patchRepo, { recursive: true, force: true });
  }
  allocation = {};
  const failedBoot = createE2bWorkspace({
    templateId: 'fixture', command: 'npm test', maxMicrosPerSecond: 5,
    profile: e2bWorkspace.capabilities.profiles[0],
  }, async () => { throw new Error('Guest boot failed'); }, async (_, init) => {
    if (init?.method === 'POST') return Response.json({ sandboxID: 'failed-boot' }, { status: 201 });
    assert.equal(init?.method, 'DELETE');
    return new Response(null, { status: 204 });
  });
  await assert.rejects(failedBoot.provision('boot', {
    lobbyId: 'fixture', taskId: 'task', attemptId: 'boot', connectionId: 'e2b', sourceRevision: 'a'.repeat(40),
    profileId: 'fixture', region: 'fixture', deadline: Date.now() + 30_000,
  }, 'owner-key', signal, journal, async () => new Uint8Array([1, 2, 3])), /Guest boot failed/);
  assert.equal(journal.read().providerId, 'failed-boot');
  assert.deepEqual(await failedBoot.destroy('boot', 'owner-key', signal, journal), { confirmed: true });
  allocation = {};
  let agent37Creates = 0;
  let deleted = false;
  const agent37 = () => agent37Allocation('attempt', 'owner-key', journal, {
    template: 'agent37-base', type: 'default', region: 'us', resources: { cpu: 2, memory: 4, disk: 4 },
  }, async (input, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer owner-key');
    const path = new URL(String(input)).pathname;
    if (init?.method === 'POST') {
      agent37Creates++;
      const body = JSON.parse(String(init.body));
      assert.equal(body.network, 'deny-all');
      assert.deepEqual(body.public_ports, []);
      assert.equal(body.metadata.agent_os_attempt, 'attempt');
      throw new Error('Lost create response');
    }
    if (path === '/v1/instances') {
      return Response.json({ data: [{ id: 'instance', metadata: { agent_os_attempt: 'attempt' } }] });
    }
    assert.equal(path, '/v1/instances/instance');
    if (init?.method === 'DELETE') {
      deleted = true;
      return new Response(null, { status: 204 });
    }
    assert.ok(deleted);
    return new Response(null, { status: 404 });
  });
  await assert.rejects(agent37().provision(signal), /Lost create response/);
  assert.equal(await agent37().provision(signal), 'instance');
  assert.equal(agent37Creates, 1);
  assert.deepEqual(await agent37().destroy(signal), { confirmed: true });
  allocation = {};
  const operationsSeen: string[] = [];
  let policyReady = false;
  let reportedCpu = 4;
  const agent37Workspace = createAgent37Workspace({
    template: 'agent37-base', command: 'npm test', maxMicrosPerSecond: 5,
    profile: { id: 'default', cpu: 2, memoryMiB: 4096, diskMiB: 4096, isolation: 'container',
      egress: 'none', regions: ['us'], maxRuntimeMs: 30_000 },
  }, async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(init?.redirect, 'error');
    if (url.hostname === 'api.agent37.com') {
      assert.equal(headers.get('authorization'), 'Bearer owner-key');
      operationsSeen.push(init!.method!);
      if (init?.method === 'POST') return Response.json({ id: 'fixture' }, { status: 201 });
      assert.equal(url.pathname, '/v1/instances/fixture');
      if (init?.method === 'PATCH') {
        assert.deepEqual(JSON.parse(String(init.body)), { network: 'deny-all' });
        return Response.json({ type: 'default', region: 'us', resources: { cpu: reportedCpu, memory: 4, disk: 4 } },
          { status: policyReady ? 200 : 503 });
      }
      return new Response(null, { status: init?.method === 'DELETE' ? 204 : 404 });
    }
    assert.equal(headers.get('X-Agent37-Key'), 'owner-key');
    assert.equal(headers.has('authorization'), false);
    if (url.hostname === 'sandbox.agent37.app') {
      assert.equal(url.pathname, '/v1/instances/fixture/exec');
      const { command } = JSON.parse(String(init?.body));
      assert.ok(!command.includes('owner-key'));
      operationsSeen.push(command.includes('tar --') ? 'stage' : command.includes('git diff') ? 'patch' : 'run');
      return Response.json({ exit_code: 0, stdout: command.includes('git diff') ? 'patch' : '' });
    }
    assert.equal(url.hostname, 'fixture.agent37.app');
    const path = url.searchParams.get('path')!;
    if (init?.method === 'PUT') {
      assert.equal(path, '/tmp/agent-os-source.tar.gz');
      assert.deepEqual([...init.body as Uint8Array], [1, 2, 3]);
      operationsSeen.push('upload');
      return Response.json({});
    }
    return new Response(path.endsWith('/exit') ? '0' : 'logs');
  });
  const provisionAgent37 = () => agent37Workspace.provision('attempt', {
    lobbyId: 'fixture', taskId: 'task', attemptId: 'attempt', connectionId: 'agent37', sourceRevision: 'a'.repeat(40),
    profileId: 'default', region: 'us', deadline: Date.now() + 30_000,
  }, 'owner-key', signal, journal, async () => new Uint8Array([1, 2, 3]));
  await assert.rejects(provisionAgent37(), /workspace operation failed/);
  assert.deepEqual(operationsSeen, ['POST', 'PATCH']);
  policyReady = true;
  await assert.rejects(provisionAgent37(), /outside the approved workspace profile/);
  assert.deepEqual(operationsSeen, ['POST', 'PATCH', 'PATCH']);
  reportedCpu = 2;
  await provisionAgent37();
  await agent37Workspace.wait('attempt', 'owner-key', signal, journal);
  assert.deepEqual(await agent37Workspace.collect('attempt', 'owner-key', signal, journal), { exitCode: 0, logs: 'logs', patch: 'patch' });
  assert.deepEqual(await agent37Workspace.destroy('attempt', 'owner-key', signal, journal), { confirmed: true });
  assert.deepEqual(operationsSeen, ['POST', 'PATCH', 'PATCH', 'PATCH', 'upload', 'stage', 'run', 'patch', 'DELETE', 'GET']);
  const revision = 'a'.repeat(40);
  const archive = new GitHubRepoClient('example', 'project', 'installation-secret', async (input, init) => {
    assert.equal(init?.signal, signal);
    if (String(input).startsWith('https://api.github.com/')) {
      assert.equal(String(input), 'https://api.github.com/repos/example/project/tarball/' + revision);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer installation-secret');
      assert.equal(init?.redirect, 'manual');
      return new Response(null, { status: 302, headers: { location: 'https://codeload.github.com/archive' } });
    }
    assert.equal(String(input), 'https://codeload.github.com/archive');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return new Response(new Uint8Array([1, 2, 3]));
  });
  assert.deepEqual([...await archive.readSourceArchive(revision, signal)], [1, 2, 3]);
  await assert.rejects(archive.readSourceArchive('main', signal), /full source commit/);
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
  let agentEdits = 0;
  let modelCalls = 0;
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
    async provision(key, attempt, token, signal, journal, source) {
      assert.equal(token, credential);
      assert.equal(attempt.sourceRevision, 'a'.repeat(40));
      assert.equal(attempt.sourceRepository, 'example/project-' + attempt.lobbyId);
      assert.equal(attempt.sourceIntegrationId, 'github-' + attempt.lobbyId);
      assert.ok(attempt.assignedAgentId);
      assert.deepEqual([...await source!()], [1, 2, 3]);
      provisionCalls.push(key);
      await new WorkspaceAllocationRecovery(journal, operations(key)).provision(signal);
    },
    async wait(_, __, signal) {
      if (waitForCancel) await delay(30_000, undefined, { signal });
    },
    async openFileTools() {
      return {
        async readFile() { return 'original'; },
        async listFiles() { return ['README.md']; },
        async writeFile(path, content) {
          assert.equal(path, 'README.md');
          assert.equal(content, 'updated');
          agentEdits++;
          return 'staged';
        },
        createPullRequest() { return assert.fail('Workspace must not publish a PR'); },
      };
    },
    async collect() { return { exitCode: 1, tests: 'failed', patch: 'redact ' + credential, logs: 'redact ' + credential + 'x'.repeat(70_000) }; },
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
    startLobbyServer({ port: 0, store, autoDefaultLobby: false, workspaceAdapters: [adapter],
      workspaceSource: async () => new Uint8Array([1, 2, 3]),
      apiRuntimeFetch: async (_, init) => {
        assert.ok(!String(init?.body).includes(credential));
        modelCalls++;
        return Response.json({ content: modelCalls === 1
          ? [{ type: 'tool_use', id: 'edit', name: 'write_file',
            input: { path: 'README.md', content: 'updated', commit_message: 'edit' } }]
          : [{ type: 'text', text: 'Edited the staged file.' }],
        usage: { input_tokens: 100, output_tokens: 50 } });
      } });
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
      await store.createLobby({ lobby_id: lobby, org_id: 'default', name: lobby, status: 'active', visibility: lobby === 'b' ? 'public' : 'private',
        connected_agent_ids: [], message_seq: 0, created_at: now, updated_at: now, created_by: 'owner-' + lobby });
      const task: LobbyTask = { lobby_id: lobby, task_id: 'task-' + lobby, org_id: 'default', title: 'Fake workspace',
        description: 'Verify task binding', priority: 'normal', category: 'general', status: 'assigned',
        assigned_to: 'fake', assigned_by: 'owner-' + lobby, assigned_at: now };
      await store.upsertTask(task);
      await store.addIntegration({ id: 'github-' + lobby, lobby_id: lobby, provider: 'github', status: 'active',
        repo_full_name: 'example/project-' + lobby, scopes: [], installed_by_identity_ref: 'owner-' + lobby,
        created_at: now, updated_at: now });
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
    const assigned = (await store.getTask('a', 'task-a'))!;
    await store.upsertTask({ ...assigned, assigned_to: '' });
    const unassigned = await call('a', '/hosted-runs', 'POST', request);
    assert.equal(unassigned.status, 409);
    assert.match(unassigned.body.error, /Assign this task/);
    await store.upsertTask(assigned);
    await store.upsertTask({ ...assigned, status: 'completed' });
    const completed = await call('a', '/hosted-runs', 'POST', request);
    assert.equal(completed.status, 409);
    assert.match(completed.body.error, /Reopen this task/);
    await store.upsertTask(assigned);
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
    await until(() => store.readHostedState('a').runs[0].state === 'failed' ? true : undefined);
    assert.deepEqual(provisionCalls, [run.id, run.id]);
    assert.equal(store.readHostedState('a').runs[0].allocation?.providerId, run.id);
    assert.equal(allocations.size, 1);
    const artifacts = store.readHostedState('a').runs[0].artifacts;
    assert.equal(artifacts?.exitCode, 1);
    assert.equal(artifacts?.patch, undefined);
    assert.equal(artifacts?.patchUnavailable, 'credential_redacted');
    const review = await call('a', '/tasks');
    assert.deepEqual(review.body.coordination_tasks[0].workspace_run, {
      id: run.id, state: 'failed', sourceRevision: 'a'.repeat(40),
    });
    const other = await call('b', '/tasks');
    assert.equal(other.body.coordination_tasks[0].workspace_run, undefined);
    assert.equal((await call('a', '/hosted-runs/' + run.id)).body.run.artifacts.exitCode, 1);
    assert.equal((await call('a', '/hosted-runs/' + run.id, 'GET', undefined, 'observer')).status, 403);
    assert.equal((await call('b', '/hosted-runs/' + run.id)).status, 404);
    assert.equal(artifacts?.logs?.length, 65_536);
    assert.ok(artifacts?.logs?.startsWith('redact [redacted]'));
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
    actual = undefined;
    const second = await call('a', '/hosted-runs', 'POST', { ...request, attemptId: 'cancel-me' });
    assert.equal(second.status, 202);
    const competing = new HostedControls(store);
    await assert.rejects(
      competing.runModel('a', request.taskId, async () => assert.fail('Competing model run started')),
      /workspace run in progress/,
    );
    const concurrent = await call('a', '/hosted-runs', 'POST', { ...request, attemptId: 'overlap' });
    assert.equal(concurrent.status, 409);
    assert.match(concurrent.body.error, /hosted run in progress/);
    assert.equal((await call('a', '/tasks/' + request.taskId, 'PATCH', { status: 'cancelled' }, 'observer')).status, 403);
    assert.equal((await call('a', '/tasks/' + request.taskId, 'PATCH', { status: 'cancelled' })).status, 200);
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
    const rotated = (await call('a', provider, 'POST', { action: 'rotate', credential })).body.connections[0];
    assert.equal(rotated.status, 'active');
    assert.notEqual(rotated.id, request.connectionId);
    assert.equal(store.readHostedState('a').runs[1].usage[0].actual, undefined);
    assert.deepEqual((await call('a', provider, 'POST', { action: 'disconnect' })).body.connections, []);
    assert.equal((await call('b', '/provider-keys', 'POST', { provider: 'anthropic', api_key: 'fixture-model-key' })).status, 201);
    const agent = await call('b', '/hosted-agents', 'POST', { name: 'Workspace fixture', provider: 'anthropic', model: 'fixture' });
    assert.equal(agent.status, 201, JSON.stringify(agent.body));
    const agentTask = await call('b', '/tasks', 'POST', { title: 'Edit README', description: 'Update README.md.',
      assigned_to: agent.body.agent_id, output_mode: 'workspace' });
    assert.equal(agentTask.status, 201);
    assert.equal(modelCalls, 0);
    waitForCancel = false;
    actual = 20;
    await call('b', '/hosted-controls', 'PUT', { ...policy, modelPerRun: 30_000, modelPerPeriod: 30_000, concurrency: 1 });
    await call('b', provider, 'POST', { action: 'rotate', credential });
    const bSettings = await call('b', '/hosted-controls');
    const openFileTools = adapter.openFileTools;
    adapter.openFileTools = undefined;
    const unsupported = await call('b', '/hosted-runs', 'POST', { ...request, taskId: agentTask.body.task.task_id,
      connectionId: bSettings.body.connections[0].id, attemptId: 'unsupported' });
    assert.equal(unsupported.status, 409);
    assert.match(unsupported.body.error, /cannot run assigned agents/);
    assert.equal(store.readHostedState('b').runs.length, 0);
    adapter.openFileTools = openFileTools;
    await store.upsertTask({ ...agentTask.body.task, assigned_to: 'offline-agent' });
    const offline = await call('b', '/hosted-runs', 'POST', { ...request, taskId: agentTask.body.task.task_id,
      connectionId: bSettings.body.connections[0].id, attemptId: 'offline' });
    assert.equal(offline.status, 409);
    assert.match(offline.body.error, /Start the assigned hosted agent/);
    assert.equal(store.readHostedState('b').runs.length, 0);
    await store.upsertTask(agentTask.body.task);
    const execution = await call('b', '/hosted-runs', 'POST', { ...request, taskId: agentTask.body.task.task_id,
      connectionId: bSettings.body.connections[0].id, attemptId: 'agent-workspace' });
    assert.equal(execution.status, 202, JSON.stringify(execution.body));
    await until(() => store.readHostedState('b').runs.find(r => r.id === execution.body.run.id && r.cleanup === 'confirmed'));
    assert.equal(agentEdits, 1);
    assert.equal(modelCalls, 2);
    assert.equal(store.readHostedState('b').runs.find(r => r.id === execution.body.run.id)?.workspaceAgent, 'finished');
    waitForCancel = true;
    const timeoutTask = { ...agentTask.body.task, task_id: 'timeout-task', output_mode: undefined };
    await store.upsertTask(timeoutTask);
    assert.equal((await call('b', '/hosted-controls', 'PUT', {
      ...policy, computePerPeriod: 200, deadlineMs: 500,
    })).status, 200);
    const timeoutRun = await call('b', '/hosted-runs', 'POST', { ...request, taskId: timeoutTask.task_id,
      connectionId: bSettings.body.connections[0].id, attemptId: 'guest-timeout' });
    assert.equal(timeoutRun.status, 202, JSON.stringify(timeoutRun.body));
    const expired = await until(() => store.readHostedState('b').runs.find(r =>
      r.id === timeoutRun.body.run.id && r.cleanup === 'confirmed'));
    assert.equal(expired.state, 'failed');
    assert.equal(allocations.has(expired.id), false);
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
    const first = runner().respondTo('work').then(value => ({ value }), error => ({ error }));
    try {
      await until(() => requests === 1 ? true : undefined);
      assert.match(await runner().respondTo('parallel work'), /budget exhausted/);
      assert.equal(requests, 1);
    } finally { release(); }
    assert.deepEqual(await first, { value: 'finished' });
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

    const deadlineLobby = 'deadline-fixture';
    controls.setPolicy(deadlineLobby, 'owner-b', { ...policy, concurrency: 1, deadlineMs: 500 });
    const timed = controls.runModel(deadlineLobby, undefined, async (_, signal) => {
      await delay(30_000, undefined, { signal });
    });
    const results = await Promise.allSettled([
      assert.rejects(controls.runModel(deadlineLobby, undefined, async () => {}), /concurrency limit/),
      assert.rejects(timed, /aborted/i),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
    }
    assert.equal(store.readHostedState(deadlineLobby).runs.at(-1)?.state, 'failed');
  } finally {
    controls?.close();
    await server?.close();
    await delay(550); // allow the lobby store's legacy queued saves to settle
    if (previousKey === undefined) delete process.env.AGENT_OS_SECRET_ENCRYPTION_KEY;
    else process.env.AGENT_OS_SECRET_ENCRYPTION_KEY = previousKey;
    await rm(dir, { recursive: true, force: true });
  }
}
