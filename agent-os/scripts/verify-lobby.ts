#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

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
import { randomUUID } from 'node:crypto';
import type { AgentToLobbyMessage, LobbyToAgentMessage, LobbySession } from '@agent-os/protocol-core';
import { InMemoryLobbyStore, LobbyCoordinator, startLobbyServer, type Connection } from '@agent-os/lobby-server';
import { LobbyClient } from '@agent-os/lobby-client';

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

  await check('register returns registered + roster + agent-joined and assigns an id', async () => {
    const { coord, lobbyId } = await unitSetup();
    const { conn, r } = await register(coord, lobbyId, 'backend');
    assert.ok(conn.agentId, 'agent id assigned');
    assert.deepEqual(types(r.out).sort(), ['lobby-agent-joined', 'lobby-registered', 'lobby-roster']);
    const roster = find(r.out, 'lobby-roster');
    assert.equal(roster?.agents.length, 1);
  });

  await check('FLOOR CONTROL: a non-boss broadcast is rejected (anti echo-cascade)', async () => {
    const { coord, lobbyId } = await unitSetup();
    const { conn } = await register(coord, lobbyId, 'backend');
    const r = await coord.handle(conn, { type: 'lobby-message', to_agent_id: 'all', message_type: 'chat', content: 'everyone hi' });
    assert.deepEqual(types(r.out), ['lobby-error']);
    assert.match(find(r.out, 'lobby-error')?.error ?? '', /floor control/i);
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
    const admitted = await register(coord, lobbyId, 'frontend');
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

  const server = await startLobbyServer({ port: 4739, autoDefaultLobby: true });
  const lobbyUrl = `http://localhost:${server.port}`;
  const clients: LobbyClient[] = [];
  const mk = (name: string, lobbyId?: string) => {
    const c = new LobbyClient({ lobbyUrl, lobbyId, register: { type: 'lobby-register', display_name: name }, heartbeatMs: 0, reconnect: false });
    clients.push(c);
    return c;
  };

  try {
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

  } finally {
    for (const c of clients) c.close();
    await server.close();
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
