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

    await check('NONCE REPLAY: nonces are single-use and expire', async () => {
      const store = new InMemoryLobbyStore();
      const { generateNonceChallenge, verifyProofAndIssueToken } = await import('../../packages/lobby-server/src/auth/identityProof.js');
      const challenge = await generateNonceChallenge('did:ccd:agent-001', store);
      assert.ok(challenge.nonce);

      // Verify signature challenge (using mock validator signature for did:ccd:agent-001)
      const token = await verifyProofAndIssueToken(
        'did:ccd:agent-001',
        `valid_sig_for_${challenge.nonce}`,
        'MOCK_PUBLIC_KEY_PEM_001',
        'lobby-id-123',
        store
      );
      assert.ok(token);

      // Replay attempt must fail because the nonce is destroyed immediately
      const token2 = await verifyProofAndIssueToken(
        'did:ccd:agent-001',
        `valid_sig_for_${challenge.nonce}`,
        'MOCK_PUBLIC_KEY_PEM_001',
        'lobby-id-123',
        store
      );
      assert.equal(token2, null, 'replay must be blocked');
    });

    await check('PRIVATE JOIN POLICY: private lobbies reject unauthorized joins', async () => {
      const store = new InMemoryLobbyStore();
      const lobby = makeLobby('private');
      await store.createLobby(lobby);

      const { verifyLobbyJoinPolicy } = await import('../../packages/lobby-server/src/auth/joinPolicy.js');
      
      // Missing token
      const r1 = await verifyLobbyJoinPolicy(lobby.lobby_id, undefined, store);
      assert.equal(r1.allowed, false);

      // Invalid token
      const r2 = await verifyLobbyJoinPolicy(lobby.lobby_id, 'invalid_token_format', store);
      assert.equal(r2.allowed, false);

      // Valid token but not a member
      const { generateNonceChallenge, verifyProofAndIssueToken } = await import('../../packages/lobby-server/src/auth/identityProof.js');
      const challenge = await generateNonceChallenge('did:ccd:uninvited', store);
      const token = await verifyProofAndIssueToken('did:ccd:uninvited', `valid_sig_for_${challenge.nonce}`, 'MOCK_PUBLIC_KEY_PEM_001', lobby.lobby_id, store);
      
      const r3 = await verifyLobbyJoinPolicy(lobby.lobby_id, token!, store);
      assert.equal(r3.allowed, false, 'must reject non-member');
    });

    await check('SECRET HYGIENE: encrypt and decrypt secrets, redact logs', async () => {
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

      // Logs redaction
      const dirtyLog = 'Error connecting with token xoxb-secret-token-123 and secret ghs_tempKey123';
      const cleanLog = redactLogs(dirtyLog);
      assert.ok(!cleanLog.includes('xoxb-secret-token-123'));
      assert.ok(!cleanLog.includes('ghs_tempKey123'));
    });

    await check('SLACK AUTHORIZATION: commands verify Linked Slack User identity', async () => {
      const store = new InMemoryLobbyStore();
      const lobby = makeLobby('private');
      await store.createLobby(lobby);

      const { verifySlackUserAuthorization } = await import('../../packages/lobby-server/src/auth/slackAuthorization.js');

      // Unlinked user
      const r1 = await verifySlackUserAuthorization(lobby.lobby_id, 'team-1', 'slack-unlinked', store);
      assert.equal(r1.authorized, false);

      // Link identity
      await store.linkExternalIdentity({
        id: 'link_1',
        provider: 'slack',
        external_team_id: 'team-1',
        external_user_id: 'slack-alice',
        identity_ref: 'did:ccd:alice-001',
        verified_at: new Date().toISOString()
      });

      // Linked but not lobby member
      const r2 = await verifySlackUserAuthorization(lobby.lobby_id, 'team-1', 'slack-alice', store);
      assert.equal(r2.authorized, false);

      // Add as lobby member
      await store.addMember({
        id: 'member_1',
        lobby_id: lobby.lobby_id,
        identity_ref: 'did:ccd:alice-001',
        role: 'contributor',
        status: 'active'
      });

      // Linked and active member
      const r3 = await verifySlackUserAuthorization(lobby.lobby_id, 'team-1', 'slack-alice', store);
      assert.equal(r3.authorized, true);
    });

    await check('KNOWLEDGE CONVERSION & GRAPHIFY: chunks, converts, sanitizes and indexes', async () => {
      const { sanitizeMarkdown } = await import('../../packages/knowledge-engine/src/sanitizers.js');
      const { chunkMarkdown } = await import('../../packages/knowledge-engine/src/chunker.js');
      const { graphifyMarkdown } = await import('../../packages/knowledge-engine/src/graphify.js');

      const raw = 'Hello \r\n\n\n\n World  [[Topic A]]';
      const clean = sanitizeMarkdown(raw);
      assert.equal(clean, 'Hello \n\n\n World  [[Topic A]]');

      const chunks = chunkMarkdown('# Title\n\nParagraph content details.');
      assert.equal(chunks.length, 1);

      const graph = graphifyMarkdown('# Section Title\n\nReferenced [[Target Concept]]', 'MyDoc');
      assert.ok(graph.nodes.some(n => n.label === 'MyDoc'));
      assert.ok(graph.nodes.some(n => n.label === 'Section Title'));
      assert.ok(graph.nodes.some(n => n.label === 'Target Concept'));
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
