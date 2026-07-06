#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Independent Agent OS lobby server — a portable Node HTTP + WebSocket server that speaks the
 * exact protocol the Panel and relay already use (`/api/v1/agent-lobby/discover` +
 * `/ws/agent`), so they connect to it unmodified via Swarm Mode (`--lobby <url>`). It is a clean,
 * brand-neutral, clean-room reimplementation whose rules are enforced server-side by the
 * LobbyCoordinator. Pair it with a Redis-backed LobbyStore for the
 * remote swarm (apps/lobby-web); the default in-memory store fits local + the WS fallback.
 *
 *   npm run lobby                 # ws://localhost:4730
 *   npm run lobby -- --port 5000
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join, extname, sep } from 'node:path';
import { existsSync, statSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { loadEnv, type AgentToLobbyMessage, type LobbyToAgentMessage, type LobbySession, type LobbyMessage, type LobbyEventType } from '@agent-os/protocol-core';
import { InMemoryLobbyStore, type LobbyStore } from './store.js';
import { LobbyCoordinator, type Connection, type Outbound } from './coordinator.js';
import { HttpIndexerTransport, IdentityVerifier, makeVerifyIdentityFn } from '@agent-os/identity-concordium';
import { RegistryMcpClient, REGISTRY_TOOL_ALLOWLIST } from './registry-mcp.js';
import { RegistrySponsorClient, DEFAULT_SPONSOR_URL } from './registry-sponsor.js';
import { githubAppConfig, getInstallationToken, installUrl } from './integrations/github/appAuth.js';
import { listInstallationRepos, listTree, getFile, parseRepoRef } from './integrations/github/repoClient.js';
import { saveIntegrationSecret, getDecryptedSecret } from './integrations/githubApp.js';
import { generateNonceChallenge, verifyProofAndIssueToken, validateSessionToken, issueSessionToken, assertDevBridgeNotInProduction } from './auth/identityProof.js';
import { createWalletChallenge, verifyWalletChallenge } from './auth/wallet-signin.js';
import { GrpcAccountInfoSource, type AccountInfoSource } from './auth/concordium-verifier.js';
import { isLobbyManager } from './auth/lobbyAuthz.js';
import { setProviderKey, listProviderKeys, revokeProviderKey, resolveProviderKey } from './providers/key-custody.js';
import { createApiRuntimeAdapter } from '@agent-os/adapters';
import { HostedAgentRunner } from './hosted/hosted-agent-runner.js';
import type { ProviderId } from '@agent-os/protocol-core';

const DEFAULT_PORT = 4730;
const WS_PATH = '/api/v1/agent-lobby/ws/agent';

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/(?:github\.com[:\/])([^\/]+)\/([^\/\.]+)(?:\.git)?/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function parseAgentDef(fileName: string, content: string) {
  const titleMatch = content.match(/^Title:\s*(.+)$/m);
  const scopeMatch = content.match(/^Scope:\s*(.+)$/m);
  const slugMatch = content.match(/^Slug:\s*(.+)$/m);
  const runtimeMatch = content.match(/^Runtime:\s*(.+)$/m);
  const modelMatch = content.match(/^Model:\s*(.+)$/m);
  const identityMatch = content.match(/^Identity:\s*(.+)$/m);

  const promptLines = content.split('\n').filter(line => {
    const trimmed = line.trim();
    return !/^(Title|Scope|Slug|Runtime|Model|Identity):/i.test(trimmed);
  });
  const systemPrompt = promptLines.join('\n').trim();

  const slug = slugMatch?.[1]?.trim() ?? fileName.replace('.md', '');
  return {
    slug,
    name: titleMatch?.[1]?.trim() ?? fileName.replace('.md', ''),
    scope: scopeMatch?.[1]?.trim() ?? '',
    file: fileName,
    runtime: runtimeMatch?.[1]?.trim() || 'api',
    model: modelMatch?.[1]?.trim(),
    identity: identityMatch?.[1]?.trim(),
    system_prompt: systemPrompt
  };
}

async function getAgentDefinitions(lobbyId: string, store: LobbyStore): Promise<any[]> {
  const integration = await store.getIntegration(lobbyId, 'github');
  const agents: any[] = [];

  if (integration && integration.repo_full_name) {
    const { getDecryptedSecret } = await import('./integrations/githubApp.js');
    const token = await getDecryptedSecret(lobbyId, 'github', 'installation_token', store).catch(() => null);
    if (token) {
      const parsed = parseGithubUrl(integration.repo_full_name);
      if (parsed) {
        const { GitHubRepoClient } = await import('./hosted/github-repo-client.js');
        const client = new GitHubRepoClient(parsed.owner, parsed.repo, token);
        const branchName = integration.branch || 'main';
        try {
          const files = await client.readDir('agent-os/sub-agents/agents', branchName);
          const mdFiles = files.filter((f: any) => f.name.endsWith('.md') && f.type === 'file');
          for (const file of mdFiles) {
            try {
              const content = await client.readFile(file.path, branchName);
              agents.push(parseAgentDef(file.name, content));
            } catch {}
          }
          return agents;
        } catch (err) {
          console.warn('[Lobby Server] Failed to read agents from GitHub:', err);
        }
      }
    }
  }

  // Local filesystem fallback
  try {
    const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../');
    const localAgentsDir = join(REPO_ROOT, 'agent-os/sub-agents/agents');
    if (existsSync(localAgentsDir)) {
      const files = readdirSync(localAgentsDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        try {
          const content = readFileSync(join(localAgentsDir, file), 'utf-8');
          agents.push(parseAgentDef(file, content));
        } catch {}
      }
    }
  } catch (err) {
    console.warn('[Lobby Server] Failed to read agents from local fs:', err);
  }

  return agents;
}

export interface LobbyServerOptions {
  port?: number;
  store?: LobbyStore;
  coordinator?: LobbyCoordinator;
  /** Auto-create a default public lobby so `discover` always returns one (Local/Swarm convenience). */
  autoDefaultLobby?: boolean;
  /** Injected fetch for hosted API-runtime agents (tests mock the provider HTTP). Defaults to global fetch. */
  apiRuntimeFetch?: typeof fetch;
  /** On-chain account-info source for wallet sign-in (tests inject a mock; prod uses gRPC). */
  accountInfoSource?: AccountInfoSource;
}

export interface RunningLobbyServer {
  port: number;
  store: LobbyStore;
  httpServer: Server;
  close(): Promise<void>;
}

export async function startLobbyServer(options: LobbyServerOptions = {}): Promise<RunningLobbyServer> {
  // Fail-closed: refuse to boot if the dev wallet-signature bridge is enabled in production.
  assertDevBridgeNotInProduction();
  const store = options.store ?? new InMemoryLobbyStore();
  // On-chain account-info source for production wallet sign-in (gRPC unless a mock is injected).
  const accountInfoSource: AccountInfoSource = options.accountInfoSource ?? new GrpcAccountInfoSource();
  // Phase 8: wire a read-only identity verifier only when an indexer URL is configured. Without it
  // the coordinator's fail-closed default applies (a verified-identity policy denies everyone),
  // and the server still boots with no network dependency.
  const indexerUrl = process.env.AGENT_OS_CONCORDIUM_INDEXER_URL;
  const verifyIdentity = indexerUrl
    ? makeVerifyIdentityFn(new IdentityVerifier({ transport: new HttpIndexerTransport({ baseUrl: indexerUrl }) }))
    : undefined;
  // Auto-failover: opt-in appointment of a successor Boss on Boss loss (unattended swarms).
  const autoFailover = (process.env.AGENT_OS_LOBBY_AUTO_FAILOVER ?? '').toLowerCase() === 'true';
  const coordinator = options.coordinator ?? new LobbyCoordinator(store, { verifyIdentity, autoFailover });
  const autoDefault = options.autoDefaultLobby ?? true;

  // Stale-heartbeat reaping: agents that stop heartbeating (freeze, SIGKILL, network partition)
  // are removed after AGENT_OS_LOBBY_STALE_MS, freeing floor control if the Boss was the one lost.
  const STALE_MS = Number(process.env.AGENT_OS_LOBBY_STALE_MS) || 90_000;
  const SWEEP_MS = Number(process.env.AGENT_OS_LOBBY_SWEEP_MS) || 30_000;

  // Concordium Agent Registry MCP service (on-chain anchoring). When unset, agents stay
  // off-chain (wallet-signed + lobby-hosted cards) and the dashboard says so honestly.
  // Point at a hosted instance or a local `concordium/agent-registry-mcp` container's /mcp URL.
  const registryMcpUrl = process.env.AGENT_OS_AGENT_REGISTRY_MCP_URL;
  const registryMcp = registryMcpUrl ? new RegistryMcpClient(registryMcpUrl) : undefined;

  // Concordium sponsor service — makes Agent-ID minting gasless (Concordium pays the energy).
  // Defaults to the Concordium-hosted endpoint; only enabled alongside the registry MCP service
  // (there is nothing to sponsor without on-chain anchoring). Relays unsigned payloads only — no
  // keys pass through here. Set AGENT_OS_REGISTRY_SPONSOR_URL='' to force the self-paid path.
  const sponsorUrlRaw = process.env.AGENT_OS_REGISTRY_SPONSOR_URL;
  const sponsorUrl = sponsorUrlRaw === undefined ? DEFAULT_SPONSOR_URL : sponsorUrlRaw.trim();
  const registrySponsor = registryMcp && sponsorUrl ? new RegistrySponsorClient(sponsorUrl) : undefined;

  // Persistent agent card storage — cards survive server restarts
  const CARDS_FILE = resolve(fileURLToPath(import.meta.url), '..', '..', 'agent-cards.json');
  const agentCards = new Map<string, unknown>();
  try {
    if (existsSync(CARDS_FILE)) {
      const raw = readFileSync(CARDS_FILE, 'utf-8');
      const entries = JSON.parse(raw);
      for (const [k, v] of Object.entries(entries)) agentCards.set(k, v);
      console.log(`[lobby-server] Loaded ${agentCards.size} agent cards from disk`);
    }
  } catch (e) { console.warn('[lobby-server] Could not load agent cards file:', e); }

  function persistCards() {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of agentCards) obj[k] = v;
    try {
      writeFileSync(CARDS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
      console.log(`[lobby-server] Persisted ${agentCards.size} agent cards to disk`);
    } catch (e) { console.warn('[lobby-server] Could not persist agent cards:', e); }
  }

  // Socket bookkeeping for fan-out.
  const sockets = new Map<string, WebSocket>(); // connId → socket
  const lobbyConns = new Map<string, Set<string>>(); // lobbyId → connIds
  const agentConn = new Map<string, string>(); // agentId → connId

  let defaultLobbyId: string | undefined;

  async function ensureDefaultLobby(): Promise<LobbySession> {
    const existing = (await store.listLobbies()).find((l) => l.status === 'active');
    if (existing) return existing;
    const now = new Date().toISOString();
    const lobby: LobbySession = {
      lobby_id: randomUUID(),
      org_id: 'default',
      name: 'Agent OS Lobby',
      status: 'active',
      visibility: 'public',
      connected_agent_ids: [],
      message_seq: 0,
      created_at: now,
      updated_at: now,
      created_by: 'system',
    };
    await store.createLobby(lobby);
    defaultLobbyId = lobby.lobby_id;
    return lobby;
  }

  function send(connId: string | undefined, message: LobbyToAgentMessage): void {
    if (!connId) return;
    const sock = sockets.get(connId);
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(message));
  }

  function dispatch(conn: Connection, out: Outbound[]): void {
    for (const o of out) {
      if (o.target.kind === 'self') send(conn.connId, o.message);
      else if (o.target.kind === 'agent') send(agentConn.get(o.target.agentId), o.message);
      else for (const cid of lobbyConns.get(conn.lobbyId) ?? []) send(cid, o.message); // lobby-scoped
    }
  }

  // ── Hosted (server-side) agents — run on the lobby host via the API runtime, no relay/CLI ──
  const hostedAgents = new Map<string, { runner: HostedAgentRunner; connId: string; conn: Connection }>();

  const providerIdFor = (name: string): ProviderId => {
    const n = (name || '').toLowerCase();
    return n.includes('openai') || n === 'gpt' ? 'openai-compatible' : 'anthropic-compatible';
  };

  // The coordinator delivers a lobby message to a hosted agent through its virtual socket; here we
  // run one API-runtime turn and post the reply back through the coordinator (broadcast if Boss,
  // else a direct reply). Self-echoes and unrelated messages are ignored to prevent cascades.
  async function onHostedInbound(conn: Connection, data: string): Promise<void> {
    let msg: { type?: string; message?: Record<string, unknown> };
    try { msg = JSON.parse(data); } catch { return; }
    if (msg?.type !== 'lobby-message-received' || !msg.message) return;
    const m = msg.message as { from_agent_id?: string; to_agent_id?: string; content?: string };
    const myId = conn.agentId;
    if (!myId || m.from_agent_id === myId) return;
    const entry = hostedAgents.get(myId);
    if (!entry) return;
    const lobby = await store.getLobby(conn.lobbyId);
    const isBoss = lobby?.boss_agent_id === myId;
    const isBroadcast = ['all', '*', 'broadcast'].includes(String(m.to_agent_id ?? '').toLowerCase());
    if (m.to_agent_id !== myId && !(isBroadcast && isBoss)) return; // respond only to us, or broadcasts as Boss
    let reply = '';
    try { reply = await entry.runner.respondTo(String(m.content ?? '')); } catch { return; }
    if (!reply) return;
    const res = await coordinator.handle(conn, {
      type: 'lobby-message',
      to_agent_id: isBoss ? 'all' : (m.from_agent_id ?? 'all'),
      message_type: 'chat',
      content: reply.length > 4000 ? reply.slice(0, 4000) + '\n\n_(truncated)_' : reply,
    } as AgentToLobbyMessage);
    dispatch(conn, res.out);
  }

  // Launch a hosted agent: open an API-runtime session with the resolved key and register it into
  // the lobby via a virtual socket so it shows in the roster and receives messages like any agent.
  async function spawnHostedAgent(params: {
    lobbyId: string; name: string; role?: string; apiKey: string; providerId: ProviderId;
    model: string; baseUrl?: string; systemPrompt?: string; joinToken?: string;
  }): Promise<string> {
    const kb = await store.getKnowledgeBase(params.lobbyId);
    let repoClient: any = undefined;
    if (kb && kb.repository_url) {
      const { getDecryptedSecret } = await import('./integrations/githubApp.js');
      const githubToken = await getDecryptedSecret(params.lobbyId, 'github', 'installation_token', store).catch(() => null);
      if (githubToken) {
        const match = kb.repository_url.match(/(?:github\.com[:\/])([^\/]+)\/([^\/\.]+)(?:\.git)?/);
        if (match) {
          const owner = match[1];
          const repo = match[2];
          const { GitHubRepoClient } = await import('./hosted/github-repo-client.js');
          repoClient = new GitHubRepoClient(owner, repo, githubToken);
        }
      }
    }

    const adapter = createApiRuntimeAdapter({
      provider: { id: params.providerId, model: params.model, baseUrl: params.baseUrl },
      apiKey: params.apiKey,
      fetchFn: options.apiRuntimeFetch,
      repoClient,
    });
    const runner = new HostedAgentRunner(adapter, { systemPrompt: params.systemPrompt });
    await runner.start();

    const connId = `hosted-${randomUUID()}`;
    const conn: Connection = { connId, lobbyId: params.lobbyId, orgId: 'default' };
    const virtualSocket = {
      readyState: WebSocket.OPEN,
      send: (data: string) => { void onHostedInbound(conn, data); },
      close: () => {},
      terminate: () => {},
    } as unknown as WebSocket;
    sockets.set(connId, virtualSocket);
    if (!lobbyConns.has(params.lobbyId)) lobbyConns.set(params.lobbyId, new Set());
    lobbyConns.get(params.lobbyId)!.add(connId);

    const reg = await coordinator.handle(conn, {
      type: 'lobby-register',
      display_name: params.name,
      agent_role: params.role,
      runtime: 'api',
      model: params.model,
      join_token: params.joinToken,
    } as AgentToLobbyMessage);
    if (conn.agentId) agentConn.set(conn.agentId, connId);
    dispatch(conn, reg.out);
    const agentId = conn.agentId ?? connId;
    hostedAgents.set(agentId, { runner, connId, conn });
    return agentId;
  }

  async function stopHostedAgent(agentId: string): Promise<boolean> {
    const entry = hostedAgents.get(agentId);
    if (!entry) return false;
    await entry.runner.stop();
    const res = await coordinator.onDisconnect(entry.conn).catch(() => ({ out: [] as Outbound[] }));
    dispatch(entry.conn, res.out);
    sockets.delete(entry.connId);
    lobbyConns.get(entry.conn.lobbyId)?.delete(entry.connId);
    agentConn.delete(agentId);
    hostedAgents.delete(agentId);
    return true;
  }

  // ── HTTP control plane ──
  const httpServer = createServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      console.error('[lobby-server] HTTP handler error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ error: 'internal server error' }));
      } else {
        res.end();
      }
    });
  });

  /** Append a canonical event to a lobby's durable log (no-op when the lobby does not exist). */
  async function recordEvent(lobbyId: string, type: LobbyEventType, actorId: string, detail?: Record<string, unknown>): Promise<void> {
    if (!(await store.getLobby(lobbyId))) return;
    const seq = await store.nextSeq(lobbyId);
    await store.appendEvent({
      event_id: randomUUID(),
      lobby_id: lobbyId,
      seq,
      type,
      actor_id: actorId,
      at: new Date().toISOString(),
      detail,
    });
  }

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const json = (body: unknown, status = 200): void => {
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(body));
    };

    // Extract + validate a Bearer session token (HMAC-signed by /auth/verify) for a given lobby.
    // Returns the wallet identity_ref the token is bound to, or null. This is the wallet-lock: a
    // request may only act as the wallet it proved control of. (Exposed to gated endpoints below.)
    const sessionIdentity = (lobbyId: string): string | null => {
      const h = req.headers['authorization'];
      const token = typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7).trim() : '';
      if (!token) return null;
      const payload = validateSessionToken(token, lobbyId);
      return payload ? payload.identityRef : null;
    };

    const ghToken = async (lobbyId: string): Promise<string | null> => {
      const integ = await store.getIntegration(lobbyId, 'github');
      if (!integ || integ.status !== 'active' || !integ.installation_id) return null;
      try { return await getInstallationToken(integ.installation_id); } catch { return null; }
    };

    if (path === '/health') return json({ ok: true, lobbies: (await store.listLobbies()).length });

    // ── Wallet session auth (Hosted Mode) — nonce challenge → wallet signature → session token ──
    // POST /api/v1/agent-lobby/auth/nonce  { identity_ref, lobby_id } → { nonce, expires_at }
    if (path === '/api/v1/agent-lobby/auth/nonce' && req.method === 'POST') {
      const body = await readBody(req);
      const identityRef = typeof body.identity_ref === 'string' ? body.identity_ref.trim() : '';
      const lobbyId = typeof body.lobby_id === 'string' ? body.lobby_id.trim() : '';
      if (!identityRef || !lobbyId) return json({ error: 'identity_ref and lobby_id are required' }, 400);
      const challenge = await generateNonceChallenge(identityRef, lobbyId, store);
      return json({ nonce: challenge.nonce, expires_at: challenge.expiresAt });
    }

    // POST /api/v1/agent-lobby/auth/verify  { identity_ref, lobby_id, signature, public_key }
    //   → { token, expires_at }  (401 on bad proof). The wallet signs the nonce from /auth/nonce.
    if (path === '/api/v1/agent-lobby/auth/verify' && req.method === 'POST') {
      const body = await readBody(req);
      const identityRef = typeof body.identity_ref === 'string' ? body.identity_ref.trim() : '';
      const lobbyId = typeof body.lobby_id === 'string' ? body.lobby_id.trim() : '';
      const signature = typeof body.signature === 'string' ? body.signature : '';
      const publicKey = typeof body.public_key === 'string' ? body.public_key : '';
      if (!identityRef || !lobbyId || !signature || !publicKey) {
        return json({ error: 'identity_ref, lobby_id, signature, public_key are required' }, 400);
      }
      const token = await verifyProofAndIssueToken(identityRef, signature, publicKey, lobbyId, store);
      if (!token) return json({ error: 'invalid or expired proof' }, 401);
      return json({ token, expires_at: Date.now() + 15 * 60 * 1000 });
    }

    // ── Production wallet sign-in — bound single-use challenge → Concordium ed25519 verify ──
    // Derive origin from the request so the challenge is bound to where it was issued.
    const requestOrigin = (): string => {
      const o = req.headers['origin'];
      if (typeof o === 'string' && o) return o;
      const host = req.headers['host'];
      return host ? `http://${host}` : 'unknown';
    };

    // POST /api/v1/agent-lobby/auth/challenge { account, lobby_id, network?, session_id? }
    //   → { challenge_id, challenge, session_id, expires_at }  (client signs `challenge`)
    if (path === '/api/v1/agent-lobby/auth/challenge' && req.method === 'POST') {
      const body = await readBody(req);
      const account = typeof body.account === 'string' ? body.account.trim() : '';
      const lobbyId = typeof body.lobby_id === 'string' ? body.lobby_id.trim() : '';
      if (!account || !lobbyId) return json({ error: 'account and lobby_id are required' }, 400);
      try {
        const ch = await createWalletChallenge(store, {
          account, lobbyId, origin: requestOrigin(),
          network: body.network, sessionId: typeof body.session_id === 'string' ? body.session_id : undefined,
        });
        return json({ challenge_id: ch.challengeId, challenge: ch.challenge, session_id: ch.sessionId, expires_at: ch.expiresAt });
      } catch {
        return json({ error: 'invalid account address' }, 400);
      }
    }

    // POST /api/v1/agent-lobby/auth/verify-wallet { challenge_id, account, signature, session_id }
    //   → { token, identity_ref } (401 on any failure — generic, never reveals which check failed)
    if (path === '/api/v1/agent-lobby/auth/verify-wallet' && req.method === 'POST') {
      const body = await readBody(req);
      const challengeId = typeof body.challenge_id === 'string' ? body.challenge_id : '';
      const account = typeof body.account === 'string' ? body.account.trim() : '';
      const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
      if (!challengeId || !account || !body.signature || !sessionId) return json({ error: 'invalid or expired challenge' }, 401);
      const result = await verifyWalletChallenge(store, accountInfoSource, {
        challengeId, account, signature: body.signature, origin: requestOrigin(), sessionId,
      });
      if (!result) return json({ error: 'invalid or expired challenge' }, 401);
      return json({ token: result.token, identity_ref: result.identityRef, expires_at: Date.now() + 15 * 60 * 1000 });
    }

    // GET /api/v1/agent-lobby/lobbies/:id/session — whoami: the wallet the Bearer token proves.
    // Used by the panel/CLI to confirm a live session and by gated endpoints (PR3) as the authz base.
    const sessionMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/session$/);
    if (sessionMatch && req.method === 'GET') {
      const identityRef = sessionIdentity(sessionMatch[1]);
      if (!identityRef) return json({ authenticated: false }, 401);
      return json({ authenticated: true, identity_ref: identityRef, lobby_id: sessionMatch[1] });
    }

    // ── Hosted-Mode provider keys (wallet-gated) — configure model API keys for a lobby or agent ──
    // All require a Bearer session token whose wallet manages the lobby (owner/admin). The key is
    // sealed at rest and never returned; responses carry only masked hints.
    const pkMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/provider-keys(?:\/([^/]+))?$/);
    if (pkMatch) {
      const lobbyId = pkMatch[1];
      const keyId = pkMatch[2];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await isLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      // GET .../provider-keys — list configured keys (masked)
      if (req.method === 'GET' && !keyId) {
        return json({ provider_keys: await listProviderKeys(store, lobbyId) });
      }
      // POST .../provider-keys — set/replace a key { provider, api_key, agent_ref?, base_url?, model? }
      if (req.method === 'POST' && !keyId) {
        const body = await readBody(req);
        try {
          const view = await setProviderKey(store, {
            lobbyId,
            provider: String(body.provider ?? ''),
            apiKey: String(body.api_key ?? ''),
            agentRef: typeof body.agent_ref === 'string' && body.agent_ref.trim() ? body.agent_ref.trim() : null,
            baseUrl: typeof body.base_url === 'string' ? body.base_url : undefined,
            model: typeof body.model === 'string' ? body.model : undefined,
            identityRef,
          });
          await recordEvent(lobbyId, 'provider_key_configured', identityRef, { provider: view.provider, scope: view.scope, agent_ref: view.agent_ref });
          return json({ provider_key: view }, 201);
        } catch (e) {
          return json({ error: String((e as Error).message ?? e) }, 400);
        }
      }
      // DELETE .../provider-keys/:id — revoke a key
      if (req.method === 'DELETE' && keyId) {
        const view = await revokeProviderKey(store, keyId);
        if (!view || view.lobby_id !== lobbyId) return json({ error: 'provider key not found' }, 404);
        await recordEvent(lobbyId, 'provider_key_revoked', identityRef, { provider: view.provider, scope: view.scope });
        return json({ revoked: view });
      }
    }

    // ── Hosted agents (wallet-gated) — launch/stop server-side agents that run via the API runtime ──
    const hostedMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/hosted-agents(?:\/([^/]+))?$/);
    if (hostedMatch) {
      const lobbyId = hostedMatch[1];
      const agentId = hostedMatch[2];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await isLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      // GET .../hosted-agents — list the running hosted agents in this lobby.
      if (req.method === 'GET' && !agentId) {
        const list = [...hostedAgents.entries()].filter(([, v]) => v.conn.lobbyId === lobbyId).map(([id]) => ({ agent_id: id }));
        return json({ hosted_agents: list });
      }
      // POST .../hosted-agents — launch { name, agent_role?, provider?, model?, base_url?, system_prompt?, agent_ref? }
      if (req.method === 'POST' && !agentId) {
        const body = await readBody(req);
        const providerName = typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : 'anthropic';
        const agentRef = typeof body.agent_ref === 'string' && body.agent_ref.trim() ? body.agent_ref.trim() : null;
        const resolved = await resolveProviderKey(store, lobbyId, providerName, agentRef);
        if (!resolved) return json({ error: `no provider key configured for "${providerName}" — set one first (POST .../provider-keys)` }, 400);
        const model = (typeof body.model === 'string' && body.model.trim()) || resolved.model || 'claude-opus-4-8';
        let systemPrompt = typeof body.system_prompt === 'string' ? body.system_prompt : undefined;
        if (!systemPrompt && typeof body.agent_role === 'string') {
          try {
            const defs = await getAgentDefinitions(lobbyId, store);
            const def = defs.find(d => d.slug === body.agent_role);
            if (def && def.system_prompt) {
              systemPrompt = def.system_prompt;
            }
          } catch (e) {
            console.warn('[Lobby Server] Failed to resolve system prompt for hosted agent:', e);
          }
        }

        try {
          const newId = await spawnHostedAgent({
            lobbyId,
            name: typeof body.name === 'string' && body.name.trim() ? body.name.slice(0, 120) : 'Hosted Agent',
            role: typeof body.agent_role === 'string' ? body.agent_role : undefined,
            apiKey: resolved.apiKey,
            providerId: providerIdFor(providerName),
            model,
            baseUrl: resolved.baseUrl,
            systemPrompt,
            joinToken: agentRef ?? undefined,
          });
          await recordEvent(lobbyId, 'hosted_agent_launched', identityRef, { agent_id: newId, provider: providerName, model, scope: resolved.scope });
          return json({ agent_id: newId, name: body.name ?? 'Hosted Agent', model, provider: providerName }, 201);
        } catch (e) {
          return json({ error: `failed to launch hosted agent: ${String((e as Error).message ?? e)}` }, 500);
        }
      }
      // DELETE .../hosted-agents/:agentId — stop a hosted agent.
      if (req.method === 'DELETE' && agentId) {
        const stopped = await stopHostedAgent(agentId);
        if (!stopped) return json({ error: 'hosted agent not found' }, 404);
        await recordEvent(lobbyId, 'hosted_agent_stopped', identityRef, { agent_id: agentId });
        return json({ stopped: agentId });
      }
    }

    // GET /api/v1/agent-lobby/lobbies/:id/agent-definitions
    const agentDefsMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/agent-definitions$/);
    if (agentDefsMatch && req.method === 'GET') {
      const lobbyId = agentDefsMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await isLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      try {
        const agents = await getAgentDefinitions(lobbyId, store);
        return json({ agents });
      } catch (err: any) {
        return json({ error: err.message ?? String(err) }, 500);
      }
    }

    // GET /api/v1/agent-lobby/lobbies/:id/scheduled
    const scheduledGetMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/scheduled$/);
    if (scheduledGetMatch && req.method === 'GET') {
      const lobbyId = scheduledGetMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await isLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      const defaultTasks = [
        {
          name: "graph-update",
          config: { enabled: false, description: "Update dependency graph via graph-update.sh to keep codebase intelligence current", time_utc: "03:00" },
          running: false,
          state: {}
        },
        {
          name: "pr-quality-review",
          config: { enabled: false, description: "Review merged PRs using Agent OS specialist agents, generate fix-sprint specs for issues found.", time_utc: "04:00" },
          running: false,
          state: {}
        },
        {
          name: "fix-sprint-executor",
          config: { enabled: false, description: "Execute pending fix-sprints, commit to branch, open PR for human review", time_utc: "05:00" },
          running: false,
          state: {}
        }
      ];

      const integration = await store.getIntegration(lobbyId, 'github');
      if (!integration || !integration.repo_full_name) {
        return json({ repoConfigured: false, tasks: defaultTasks });
      }

      const token = await ghToken(lobbyId);
      if (!token) {
        return json({ repoConfigured: false, tasks: defaultTasks });
      }

      const parsed = parseGithubUrl(integration.repo_full_name);
      if (!parsed) {
        return json({ repoConfigured: false, tasks: defaultTasks });
      }

      try {
        const { GitHubRepoClient } = await import('./hosted/github-repo-client.js');
        const client = new GitHubRepoClient(parsed.owner, parsed.repo, token);
        const branchName = integration.branch || 'main';
        const fileContent = await client.readFile('agent-os/config.json', branchName).catch(() => null);

        if (!fileContent) {
          return json({ repoConfigured: false, tasks: defaultTasks });
        }

        const config = JSON.parse(fileContent);
        if (config && Array.isArray(config.scheduled)) {
          const tasks = defaultTasks.map(t => {
            const remoteTask = config.scheduled.find((rt: any) => rt.name === t.name);
            if (remoteTask) {
              return {
                ...t,
                config: {
                  ...t.config,
                  enabled: remoteTask.enabled !== false,
                  time_utc: remoteTask.time_utc || t.config.time_utc
                }
              };
            }
            return t;
          });
          return json({ repoConfigured: true, tasks });
        }
      } catch (e) {
        console.warn('[Lobby Server] Failed to fetch scheduled config from GitHub:', e);
      }

      return json({ repoConfigured: false, tasks: defaultTasks });
    }

    // POST /api/v1/agent-lobby/lobbies/:id/scheduled/setup
    const scheduledSetupMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/scheduled\/setup$/);
    if (scheduledSetupMatch && req.method === 'POST') {
      const lobbyId = scheduledSetupMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await isLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      const integration = await store.getIntegration(lobbyId, 'github');
      if (!integration || !integration.repo_full_name) {
        return json({ error: 'GitHub integration not connected' }, 400);
      }

      const token = await ghToken(lobbyId);
      if (!token) return json({ error: 'GitHub installation token unavailable' }, 502);

      const parsed = parseGithubUrl(integration.repo_full_name);
      if (!parsed) return json({ error: 'Invalid GitHub repository URL' }, 400);

      const { GitHubRepoClient } = await import('./hosted/github-repo-client.js');
      const client = new GitHubRepoClient(parsed.owner, parsed.repo, token);
      const branchName = integration.branch || 'main';

      try {
        const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../');
        
        // 1. Write agent-os/config.json
        const configPath = join(REPO_ROOT, 'agent-os/scheduled/config.json');
        if (existsSync(configPath)) {
          const content = readFileSync(configPath, 'utf-8');
          await client.writeFile('agent-os/config.json', content, 'chore: setup agent-os scheduled config', branchName);
        }

        // 2. Write scheduled prompts (graph-update, pr-quality-review, fix-sprint-executor)
        const promptsDir = join(REPO_ROOT, 'agent-os/scheduled/prompts');
        if (existsSync(promptsDir)) {
          const files = readdirSync(promptsDir).filter(f => f.endsWith('.md'));
          for (const file of files) {
            const content = readFileSync(join(promptsDir, file), 'utf-8');
            await client.writeFile(`agent-os/scheduled/prompts/${file}`, content, `chore: setup scheduled prompt for ${file}`, branchName);
          }
        }

        // 3. Write core agent definitions (60 files)
        const agentsDir = join(REPO_ROOT, 'agent-os/sub-agents/agents');
        if (existsSync(agentsDir)) {
          const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'));
          for (const file of files) {
            const content = readFileSync(join(agentsDir, file), 'utf-8');
            await client.writeFile(`agent-os/sub-agents/agents/${file}`, content, `chore: bootstrap core agent definition ${file}`, branchName);
          }
        }

        await recordEvent(lobbyId, 'scheduled_tasks_configured', identityRef, { repo: integration.repo_full_name, branch: branchName });
        return json({ ok: true });
      } catch (err: any) {
        console.error('[Lobby Server] Failed to bootstrap agent-os to GitHub repo:', err);
        return json({ error: `failed to configure repository: ${err.message || String(err)}` }, 500);
      }
    }

    // ── GitHub App integration (wallet-gated) — connect the user's OWN repo so hosted agents can
    // read it and land changes as commits/PRs. We host no repo; the lobby holds only a revocable,
    // short-lived installation token. Flow: connect → install URL → GitHub redirects to the callback
    // (state carries the wallet-authed lobby binding) → store installation → pick repo + branch.


    // POST /lobbies/:id/integrations/github/connect → { install_url }
    const ghConnect = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/integrations\/github\/connect$/);
    if (ghConnect && req.method === 'POST') {
      const lobbyId = ghConnect[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await isLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);
      const cfg = githubAppConfig();
      if (!cfg || !cfg.slug) return json({ error: 'GitHub App not configured on this lobby (set GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_SLUG)' }, 503);
      const state = `${lobbyId}.${issueSessionToken(identityRef, lobbyId)}`;
      return json({ install_url: installUrl(cfg, state) });
    }

    // GET /integrations/github/callback?installation_id=&state= → store + redirect back to /panel
    if (path === '/api/v1/agent-lobby/integrations/github/callback' && req.method === 'GET') {
      const state = url.searchParams.get('state') ?? '';
      const installationId = url.searchParams.get('installation_id') ?? '';
      const dot = state.indexOf('.');
      const lobbyId = dot > 0 ? state.slice(0, dot) : '';
      const token = dot > 0 ? state.slice(dot + 1) : '';
      const payload = lobbyId && token ? validateSessionToken(token, lobbyId) : null;
      if (!payload || !installationId) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<p>GitHub connection failed: invalid or expired state. Close this window and try again from the panel.</p>');
        return;
      }
      try {
        // Validate the installation by minting a token + reading its repos (also captures the account).
        const instToken = await getInstallationToken(installationId);
        const repos = await listInstallationRepos(instToken);
        const account = repos[0]?.full_name?.split('/')[0];
        const existing = await store.getIntegration(lobbyId, 'github');
        const now = new Date().toISOString();
        let integration = existing;
        if (existing) {
          integration = await store.updateIntegration(lobbyId, existing.id, {
            status: 'active', installation_id: installationId, external_account_name: account, updated_at: now,
          }) ?? existing;
        } else {
          integration = await store.addIntegration({
            id: randomUUID(), lobby_id: lobbyId, provider: 'github', status: 'active',
            external_account_name: account, installation_id: installationId,
            scopes: ['contents', 'pull_requests'], installed_by_identity_ref: payload.identityRef,
            created_at: now, updated_at: now,
          });
        }
        await saveIntegrationSecret(integration!.id, 'installation_token', instToken, store, 3300);
        await recordEvent(lobbyId, 'github_connected', payload.identityRef, { account, repos: repos.length });
      } catch (e) {
        res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<p>GitHub connection failed: ${String((e as Error).message ?? e)}</p>`);
        return;
      }
      res.writeHead(302, { location: '/panel/?github=connected' });
      res.end();
      return;
    }

    // /lobbies/:id/integrations/github (GET status · POST repo select · DELETE revoke)
    const ghMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/integrations\/github$/);
    if (ghMatch) {
      const lobbyId = ghMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await isLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);
      const integ = await store.getIntegration(lobbyId, 'github');

      if (req.method === 'GET') {
        if (!integ || integ.status !== 'active') return json({ connected: false, configured: Boolean(githubAppConfig()) });
        let repos: unknown[] = [];
        const token = await ghToken(lobbyId);
        if (token) { try { repos = await listInstallationRepos(token); } catch { /* token stale */ } }
        return json({ connected: true, account: integ.external_account_name, repo: integ.repo_full_name, branch: integ.branch, repos });
      }
      if (req.method === 'POST') {
        if (!integ) return json({ error: 'GitHub is not connected' }, 400);
        const body = await readBody(req);
        const repo = typeof body.repo === 'string' ? body.repo.trim() : '';
        if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return json({ error: 'repo must be "owner/repo"' }, 400);
        const branch = typeof body.branch === 'string' && body.branch.trim() ? body.branch.trim() : undefined;
        const updated = await store.updateIntegration(lobbyId, integ.id, { repo_full_name: repo, branch, updated_at: new Date().toISOString() });
        await recordEvent(lobbyId, 'github_repo_selected', identityRef, { repo, branch });
        return json({ connected: true, repo: updated?.repo_full_name, branch: updated?.branch });
      }
      if (req.method === 'DELETE') {
        if (integ) await store.updateIntegration(lobbyId, integ.id, { status: 'revoked', updated_at: new Date().toISOString() });
        await recordEvent(lobbyId, 'github_disconnected', identityRef, {});
        return json({ connected: false });
      }
    }

    // GET /lobbies/:id/repo/(tree|file)?path=&ref= — browse the connected repo (Files tab).
    const repoMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/repo\/(tree|file)$/);
    if (repoMatch && req.method === 'GET') {
      const lobbyId = repoMatch[1];
      const kind = repoMatch[2];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await isLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);
      const integ = await store.getIntegration(lobbyId, 'github');
      if (!integ || integ.status !== 'active' || !integ.repo_full_name) return json({ error: 'no connected repo — connect GitHub and select a repo first' }, 400);
      const token = await ghToken(lobbyId);
      if (!token) return json({ error: 'could not obtain a GitHub installation token (reconnect GitHub)' }, 502);
      const ref = url.searchParams.get('ref') || integ.branch || 'HEAD';
      const p = url.searchParams.get('path') || '';
      try {
        const repoRef = parseRepoRef(integ.repo_full_name);
        if (kind === 'tree') return json({ path: p, ref, entries: await listTree(token, repoRef, p, ref) });
        return json({ path: p, ref, ...(await getFile(token, repoRef, p, ref)) });
      } catch (e) {
        return json({ error: String((e as Error).message ?? e) }, 502);
      }
    }

    // ── KB (Knowledge Base) endpoints (wallet-gated) ──
    const kbMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/kb(?:\/(upload|jobs))?$/);
    if (kbMatch) {
      const lobbyId = kbMatch[1];
      const action = kbMatch[2]; // undefined, 'upload', or 'jobs'
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await isLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      // GET .../kb — get KB settings
      if (req.method === 'GET' && !action) {
        const kb = await store.getKnowledgeBase(lobbyId);
        return json({ kb: kb || null });
      }

      // POST .../kb — update/create KB settings
      if (req.method === 'POST' && !action) {
        const body = await readBody(req);
        const repositoryUrl = typeof body.repository_url === 'string' ? body.repository_url.trim() : '';
        const branch = typeof body.branch === 'string' ? body.branch.trim() : 'main';
        const kbRootPath = typeof body.kb_root_path === 'string' ? body.kb_root_path.trim() : 'kb';
        if (!repositoryUrl) return json({ error: 'repository_url is required' }, 400);

        const existing = await store.getKnowledgeBase(lobbyId);
        const kb = await store.upsertKnowledgeBase({
          id: existing?.id || randomUUID(),
          lobby_id: lobbyId,
          repository_url: repositoryUrl,
          branch,
          kb_root_path: kbRootPath,
          latest_commit_sha: existing?.latest_commit_sha,
          last_synced_at: existing?.last_synced_at,
          last_indexed_at: existing?.last_indexed_at,
        });

        await recordEvent(lobbyId, 'kb_configured', identityRef, { repository_url: repositoryUrl, branch, kb_root_path: kbRootPath });
        return json({ kb });
      }

      // GET .../kb/jobs — list sync jobs
      if (req.method === 'GET' && action === 'jobs') {
        const jobs = await store.listKnowledgeSyncJobs(lobbyId);
        return json({ jobs });
      }

      // POST .../kb/upload — upload file for KB conversion
      if (req.method === 'POST' && action === 'upload') {
        const body = await readBody(req);
        const fileName = typeof body.file_name === 'string' ? body.file_name.trim() : '';
        const mimeType = typeof body.mime_type === 'string' ? body.mime_type.trim() : '';
        const fileContentBase64 = typeof body.file_content === 'string' ? body.file_content : '';

        if (!fileName || !mimeType || !fileContentBase64) {
          return json({ error: 'file_name, mime_type, and file_content (base64) are required' }, 400);
        }

        const buffer = Buffer.from(fileContentBase64, 'base64');
        const jobId = `job_${randomUUID()}`;
        const job = await store.upsertKnowledgeSyncJob({
          id: jobId,
          lobby_id: lobbyId,
          kb_id: (await store.getKnowledgeBase(lobbyId))?.id || 'none',
          source_provider: 'upload',
          status: 'queued',
          created_by_identity_ref: identityRef,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        // Trigger processing in the background asynchronously
        const { processKnowledgeSyncJob } = await import('./kb/jobs.js');
        processKnowledgeSyncJob(jobId, buffer, fileName, mimeType, store).catch((err) => {
          console.error(`[KB Upload] Async processing failed for job ${jobId}:`, err);
        });

        return json({ job }, 202);
      }
    }

    // The lobby only relays reads and sign-ready payload builders; signing and submission
    // happen in the owner's wallet, client-side. No keys pass through here.

    // GET /api/v1/agent-lobby/registry/status
    if (path === '/api/v1/agent-lobby/registry/status' && req.method === 'GET') {
      if (!registryMcp) return json({ configured: false });
      const network = url.searchParams.get('network') ?? 'mainnet';
      try {
        const capabilities = await registryMcp.callTool('agent_registry_capabilities', { network });
        return json({ configured: true, network, capabilities, sponsored: Boolean(registrySponsor) });
      } catch (e) {
        return json({ configured: true, network, sponsored: Boolean(registrySponsor), error: String((e as Error).message ?? e) }, 502);
      }
    }

    // GET /api/v1/agent-lobby/registry/tools
    if (path === '/api/v1/agent-lobby/registry/tools' && req.method === 'GET') {
      if (!registryMcp) return json({ error: 'agent registry MCP service not configured (set AGENT_OS_AGENT_REGISTRY_MCP_URL)' }, 503);
      try {
        const tools = (await registryMcp.listTools()).filter((t) => REGISTRY_TOOL_ALLOWLIST.has(t.name));
        return json({ tools });
      } catch (e) {
        return json({ error: String((e as Error).message ?? e) }, 502);
      }
    }

    // POST /api/v1/agent-lobby/registry/call — allowlisted tools/call relay
    if (path === '/api/v1/agent-lobby/registry/call' && req.method === 'POST') {
      if (!registryMcp) return json({ error: 'agent registry MCP service not configured (set AGENT_OS_AGENT_REGISTRY_MCP_URL)' }, 503);
      const body = await readBody(req);
      const tool = typeof body.tool === 'string' ? body.tool : '';
      if (!REGISTRY_TOOL_ALLOWLIST.has(tool)) {
        return json({ error: `tool not allowed: ${tool || '(missing)'}` }, 400);
      }
      const args = body.arguments && typeof body.arguments === 'object' ? body.arguments : {};
      try {
        const result = await registryMcp.callTool(tool, args);
        return json({ ok: true, tool, result });
      } catch (e) {
        // Return 200 with ok:false for a handled upstream MCP error. Clients inspect `ok` (e.g. the
        // optional agent_by_external_reference existence probe, which many MCP deployments 502 on
        // because they run without an Indexer). A 200 keeps the browser from logging a red network
        // error for an expected, already-handled failure.
        return json({ ok: false, tool, error: String((e as Error).message ?? e) });
      }
    }

    // POST /api/v1/agent-lobby/registry/sponsor — gasless mint relay to the Concordium sponsor
    // service. Forwards the wallet-built unsigned Transaction.JSON and returns the partially-signed
    // transaction (sponsor co-signature attached) for the owner's wallet to complete and submit.
    // No keys pass through the lobby; the request/response are opaque transaction JSON.
    if (path === '/api/v1/agent-lobby/registry/sponsor' && req.method === 'POST') {
      if (!registrySponsor) {
        return json({ ok: false, error: 'sponsored minting not available (no registry MCP service, or AGENT_OS_REGISTRY_SPONSOR_URL is empty)' }, 503);
      }
      const body = await readBody(req);
      const genesisHash = typeof body.genesisHash === 'string' ? body.genesisHash : '';
      const sender = typeof body.sender === 'string' ? body.sender : '';
      const nonce = typeof body.nonce === 'number' ? body.nonce : Number(body.nonce);
      const payload = body.payload && typeof body.payload === 'object' ? (body.payload as Record<string, unknown>) : null;
      if (!genesisHash || !sender || !payload || !Number.isInteger(nonce) || nonce <= 0) {
        return json({ ok: false, error: 'sponsor request requires genesisHash, sender, positive integer nonce, and an unsigned payload object' }, 400);
      }
      try {
        const transaction = await registrySponsor.sponsor({ genesisHash, payload, sender, nonce });
        return json({ ok: true, transaction });
      } catch (e) {
        return json({ ok: false, error: String((e as Error).message ?? e) }, 502);
      }
    }

    // POST /api/v1/agent-lobby/agent-cards
    if (path === '/api/v1/agent-lobby/agent-cards' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.did || !body.card) {
        return json({ error: 'missing did or card' }, 400);
      }
      const MAX_CARDS = 5000;
      const MAX_CARD_BYTES = 65_536;
      if (JSON.stringify(body.card).length > MAX_CARD_BYTES) {
        return json({ error: 'card too large' }, 413);
      }
      if (!agentCards.has(body.did) && agentCards.size >= MAX_CARDS) {
        return json({ error: 'card store full' }, 507);
      }
      agentCards.set(body.did, body.card);
      persistCards();
      console.log(`[lobby-server] Stored agent card: ${body.did}`);
      if (typeof body.lobby_id === 'string') {
        const card = body.card as Record<string, unknown>;
        await recordEvent(body.lobby_id, 'agent_card_published', String(card?.owner ?? 'unknown'), {
          did: body.did,
          name: card?.name,
          signed: Boolean(card?.signature),
        });
      }
      return json({ ok: true, url: `${url.origin}/agent-cards/${encodeURIComponent(body.did)}` }, 201);
    }

    // GET /api/v1/agent-lobby/agent-cards/:did or /agent-cards/:did
    // DID contains colons so we match everything after /agent-cards/
    const agentCardMatch = path.match(/^(?:\/api\/v1\/agent-lobby)?\/agent-cards\/(.+)$/);
    if (agentCardMatch && req.method === 'GET') {
      const did = decodeURIComponent(agentCardMatch[1]);
      const card = agentCards.get(did);
      if (!card) return json({ error: 'agent card not found', did, stored: Array.from(agentCards.keys()) }, 404);
      return json(card);
    }

    // Public discovery — shape matches what the Panel/relay parse.
    if (path === '/api/v1/agent-lobby/discover' && req.method === 'GET') {
      const lobby = autoDefault ? await ensureDefaultLobby() : (await store.listLobbies()).find((l) => l.status === 'active');
      return json({ lobby: lobby ? { lobby_id: lobby.lobby_id, org_id: lobby.org_id, name: lobby.name, visibility: lobby.visibility, join_policy: lobby.join_policy } : null });
    }

    if (path === '/api/v1/agent-lobby/lobbies' && req.method === 'GET') {
      return json({ lobbies: await store.listLobbies() });
    }

    if (path === '/api/v1/agent-lobby/stats' && req.method === 'GET') {
      const lobbies = await store.listLobbies();
      let connected_users = 0;
      let connected_agents = 0;
      let verified_agents = 0;
      const seenAgents = new Set<string>();

      for (const lobby of lobbies) {
        const roster = await store.roster(lobby.lobby_id);
        for (const agent of roster) {
          if (seenAgents.has(agent.agent_id)) continue;
          seenAgents.add(agent.agent_id);

          if (agent.participant_type === 'human' || agent.role === 'human') {
            connected_users++;
          } else {
            connected_agents++;
            if (agent.identity_status === 'registry_verified' || agent.identity_status === 'human_linked' || agent.identity_status === 'org_linked') {
              verified_agents++;
            }
          }
        }
      }

      return json({
        connected_users,
        connected_agents,
        verified_agents,
        total_lobbies: lobbies.length,
        public_lobbies: lobbies.filter(l => l.visibility === 'public').length,
        private_lobbies: lobbies.filter(l => l.visibility === 'private').length
      });
    }

    if (path === '/api/v1/agent-lobby/lobbies' && req.method === 'POST') {
      const body = await readBody(req);
      // Validate enums — these values flow into stored lobby records and dashboard markup.
      const visibility = body.visibility === 'private' ? 'private' : 'public';
      const JOIN_POLICIES = new Set(['none', 'registered', 'allowlisted', 'verified_human_link']);
      const joinPolicy = JOIN_POLICIES.has(body.join_policy) ? body.join_policy : undefined;
      const allowlist = Array.isArray(body.allowlist)
        ? body.allowlist.filter((x: unknown) => typeof x === 'string').slice(0, 200)
        : undefined;
      const now = new Date().toISOString();
      // Hosted Mode: bind the lobby to the creating wallet so it (and only it) can manage config
      // later. `owner_identity_ref` is trusted at creation as first-writer — claiming a wallet you
      // don't control only locks YOU out, since managing the lobby later requires proving that
      // wallet (auth/verify). Legacy/local callers omit it and get the unowned 'system' default.
      const ownerRef = typeof body.owner_identity_ref === 'string' && body.owner_identity_ref.trim()
        ? body.owner_identity_ref.trim()
        : (typeof body.created_by === 'string' ? body.created_by : 'system');
      const lobbyId = randomUUID();
      const lobby: LobbySession = {
        lobby_id: lobbyId,
        org_id: typeof body.org_id === 'string' ? body.org_id : 'default',
        name: typeof body.name === 'string' ? body.name.slice(0, 120) : 'Lobby',
        status: 'active',
        visibility,
        join_policy: joinPolicy,
        allowlist,
        connected_agent_ids: [],
        message_seq: 0,
        created_at: now,
        updated_at: now,
        created_by: ownerRef,
      };
      await store.createLobby(lobby);
      // Record the owner as a member so isLobbyManager resolves via membership too.
      if (ownerRef !== 'system') {
        await store.addMember({
          id: `mem_${randomUUID()}`,
          lobby_id: lobbyId,
          identity_ref: ownerRef,
          role: 'owner',
          status: 'active',
        });
      }
      return json({ lobby }, 201);
    }

    const lobbyMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)(\/(roster|events|messages|members))?$/);
    if (lobbyMatch && req.method === 'GET') {
      const lobbyId = lobbyMatch[1];
      const sub = lobbyMatch[3];
      if (sub === 'roster') return json({ agents: await store.roster(lobbyId) });
      if (sub === 'events') return json({ events: await store.listEvents(lobbyId) });
      if (sub === 'messages') return json({ messages: await store.listMessages(lobbyId) });
      if (sub === 'members') return json({ members: await store.listMembers(lobbyId) });
      const lobby = await store.getLobby(lobbyId);
      return lobby ? json({ lobby }) : json({ error: 'not found' }, 404);
    }

    // ── Lobby management (Manage view): settings + membership ──

    // PATCH /api/v1/agent-lobby/lobbies/:id — update name / visibility / join policy / allowlist
    const lobbySettingsMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)$/);
    if (lobbySettingsMatch && req.method === 'PATCH') {
      const lobbyId = lobbySettingsMatch[1];
      const lobby = await store.getLobby(lobbyId);
      if (!lobby) return json({ error: 'lobby not found' }, 404);
      const body = await readBody(req);
      const patch: Record<string, unknown> = {};
      if (typeof body.name === 'string') patch.name = body.name.slice(0, 120);
      if (body.visibility === 'public' || body.visibility === 'private') patch.visibility = body.visibility;
      const JOIN_POLICIES = new Set(['none', 'registered', 'allowlisted', 'verified_human_link']);
      if (JOIN_POLICIES.has(body.join_policy)) patch.join_policy = body.join_policy;
      if (Array.isArray(body.allowlist)) {
        patch.allowlist = body.allowlist.filter((x: unknown) => typeof x === 'string').slice(0, 200);
      }
      const updated = await store.updateLobby(lobbyId, patch);
      await recordEvent(lobbyId, 'lobby_settings_updated', String(body.actor ?? 'web-user'), { changed: Object.keys(patch) });
      return json({ lobby: updated });
    }

    // POST /api/v1/agent-lobby/lobbies/:id/members — invite a member
    const membersMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/members$/);
    if (membersMatch && req.method === 'POST') {
      const lobbyId = membersMatch[1];
      const lobby = await store.getLobby(lobbyId);
      if (!lobby) return json({ error: 'lobby not found' }, 404);
      const body = await readBody(req);
      const identityRef = typeof body.identity_ref === 'string' ? body.identity_ref.trim() : '';
      if (!identityRef) return json({ error: 'identity_ref is required' }, 400);
      const ROLES = new Set(['owner', 'admin', 'boss', 'contributor', 'observer', 'agent']);
      const role = ROLES.has(body.role) ? body.role : 'contributor';
      const existing = await store.getMember(lobbyId, identityRef);
      if (existing) {
        // Re-inviting a revoked member re-activates the invite.
        const reinvited = await store.updateMember(lobbyId, existing.id, { status: 'invited', role });
        return json({ member: reinvited });
      }
      const member = await store.addMember({
        id: randomUUID(),
        lobby_id: lobbyId,
        identity_ref: identityRef,
        role,
        status: 'invited',
        invited_by_identity_ref: typeof body.invited_by_identity_ref === 'string' ? body.invited_by_identity_ref : undefined,
      });
      // Keep the lobby allowlist in sync so the join policy actually admits the invitee.
      const allowlist = new Set(lobby.allowlist ?? []);
      allowlist.add(identityRef);
      await store.updateLobby(lobbyId, { allowlist: [...allowlist] });
      await recordEvent(lobbyId, 'member_invited', String(body.invited_by_identity_ref ?? 'web-user'), { identity_ref: identityRef, role });
      return json({ member }, 201);
    }

    // POST /api/v1/agent-lobby/lobbies/:id/members/:memberId/status — activate / revoke (kick)
    const memberStatusMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/members\/([^/]+)\/status$/);
    if (memberStatusMatch && req.method === 'POST') {
      const lobbyId = memberStatusMatch[1];
      const memberId = memberStatusMatch[2];
      const body = await readBody(req);
      const status = body.status;
      if (status !== 'active' && status !== 'revoked' && status !== 'invited') {
        return json({ error: 'status must be active, invited, or revoked' }, 400);
      }
      const updated = await store.updateMember(lobbyId, memberId, { status });
      if (!updated) return json({ error: 'member not found' }, 404);
      if (status === 'revoked') {
        // Kicking: drop the member from the allowlist so they can no longer (re)join.
        const lobby = await store.getLobby(lobbyId);
        if (lobby?.allowlist?.length) {
          await store.updateLobby(lobbyId, { allowlist: lobby.allowlist.filter((r) => r !== updated.identity_ref) });
        }
        await recordEvent(lobbyId, 'member_revoked', String(body.actor ?? 'web-user'), { identity_ref: updated.identity_ref });
      }
      return json({ member: updated });
    }

    if (lobbyMatch && req.method === 'POST') {
      const lobbyId = lobbyMatch[1];
      const sub = lobbyMatch[3];
      if (sub === 'messages') {
        const body = await readBody(req);
        const lobby = await store.getLobby(lobbyId);
        if (!lobby) return json({ error: 'Lobby not found' }, 404);

        const fromId = body.from_agent_id || 'WebUser';
        const roster = await store.roster(lobbyId);
        if (roster.some((a) => a.agent_id === fromId && a.status !== 'disconnected')) {
          return json({ error: 'from_agent_id belongs to a connected agent — send via the agent WebSocket instead' }, 403);
        }

        const seq = await store.nextSeq(lobbyId);
        const message: LobbyMessage = {
          message_id: randomUUID(),
          seq,
          from_agent_id: fromId,
          to_agent_id: body.to_agent_id || 'all',
          message_type: body.message_type || 'chat',
          content: body.content || '',
          created_at: new Date().toISOString(),
          delivered: false,
        };
        await store.appendMessage(lobbyId, message);
        await recordEvent(lobbyId, 'message_sent', message.from_agent_id, {
          to: message.to_agent_id,
          content: message.content,
        });

        // Broadcast to WebSocket connections in this lobby
        const outMsg: LobbyToAgentMessage = { type: 'lobby-message-received', message };
        for (const cid of lobbyConns.get(lobbyId) ?? []) {
          send(cid, outMsg);
        }

        return json({ message }, 201);
      }
    }

    // --- Task Marketplace Routes ---
    
    // POST /api/v1/agent-lobby/issuers
    if (path === '/api/v1/agent-lobby/issuers' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.issuer_did || !body.identity_ref) {
        return json({ error: 'missing issuer_did or identity_ref' }, 400);
      }
      const record = await store.registerIssuer({
        issuer_did: body.issuer_did,
        identity_ref: body.identity_ref,
        registered_at: new Date().toISOString(),
        revoked: false
      });
      if (typeof body.lobby_id === 'string') {
        await recordEvent(body.lobby_id, 'owner_registered', body.identity_ref, {
          issuer_did: body.issuer_did,
          owner_name: body.owner_name,
          signed: Boolean(body.signature),
        });
      }
      return json({ record }, 201);
    }

    // POST / GET /api/v1/agent-lobby/lobbies/:id/tasks
    const taskListMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/tasks$/);
    if (taskListMatch) {
      const lobbyId = taskListMatch[1];
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body.title || !body.description || typeof body.proposed_budget_ccd !== 'number') {
          return json({ error: 'missing title, description, or proposed_budget_ccd' }, 400);
        }
        const task = await store.createMarketplaceTask({
          id: randomUUID(),
          lobby_id: lobbyId,
          title: body.title,
          description: body.description,
          proposed_budget_ccd: body.proposed_budget_ccd,
          status: 'posted',
          posted_by_identity_ref: body.posted_by_identity_ref ?? 'anonymous',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          escrow_signature: typeof body.escrow_signature === 'string' ? body.escrow_signature : undefined,
        });
        await recordEvent(lobbyId, 'task_created', task.posted_by_identity_ref, {
          task_id: task.id,
          title: task.title,
          budget_ccd: task.proposed_budget_ccd,
          escrow_signed: Boolean(task.escrow_signature),
        });
        return json({ task }, 201);
      }
      if (req.method === 'GET') {
        const tasks = await store.listMarketplaceTasks(lobbyId);
        return json({ tasks });
      }
    }

    // POST /api/v1/agent-lobby/lobbies/:id/tasks/:taskId/bid
    const bidMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/tasks\/([^/]+)\/bid$/);
    if (bidMatch && req.method === 'POST') {
      const lobbyId = bidMatch[1];
      const taskId = bidMatch[2];
      const body = await readBody(req);
      if (!body.agent_did || !body.bidder_identity_ref) {
        return json({ error: 'missing agent_did or bidder_identity_ref' }, 400);
      }
      
      const task = await store.getMarketplaceTask(lobbyId, taskId);
      if (!task) return json({ error: 'task not found' }, 404);
      
      // Verification check for agent DID and trust chain mapping to Concordium ID registry
      const verification = await coordinator.verifyIdentity(body.agent_did);
      if (verification.status === 'failed' || verification.status === 'pending' || verification.status === 'unverified') {
        return json({ error: `agent identity verification failed: ${verification.reason || 'identity unverified'}` }, 401);
      }
      const issuer = verification.issuerDid ? await store.getIssuer(verification.issuerDid) : undefined;
      if (!issuer || issuer.revoked) {
        return json({ error: 'agent credential issuer is not registered or is revoked on Concordium' }, 401);
      }
      
      const bid = await store.addTaskBid({
        id: randomUUID(),
        task_id: taskId,
        agent_did: body.agent_did,
        bidder_identity_ref: body.bidder_identity_ref,
        created_at: new Date().toISOString()
      });
      
      if (task.status === 'posted') {
        await store.updateMarketplaceTask(lobbyId, taskId, { status: 'bidded' });
      }
      
      return json({ bid }, 201);
    }

    // GET /api/v1/agent-lobby/lobbies/:id/tasks/:taskId/bids
    const getBidsMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/tasks\/([^/]+)\/bids$/);
    if (getBidsMatch && req.method === 'GET') {
      const taskId = getBidsMatch[2];
      const bids = await store.listTaskBids(taskId);
      return json({ bids });
    }

    // POST /api/v1/agent-lobby/lobbies/:id/tasks/:taskId/assign
    const assignMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/tasks\/([^/]+)\/assign$/);
    if (assignMatch && req.method === 'POST') {
      const lobbyId = assignMatch[1];
      const taskId = assignMatch[2];
      const body = await readBody(req);
      if (!body.assigned_agent_id) {
        return json({ error: 'missing assigned_agent_id' }, 400);
      }
      const task = await store.getMarketplaceTask(lobbyId, taskId);
      if (!task) return json({ error: 'task not found' }, 404);
      
      const updated = await store.updateMarketplaceTask(lobbyId, taskId, {
        status: 'assigned',
        assigned_agent_id: body.assigned_agent_id,
        assigned_agent_ref: body.assigned_agent_ref
      });
      await recordEvent(lobbyId, 'task_updated', task.posted_by_identity_ref, {
        task_id: taskId,
        status: 'assigned',
        assigned_agent_id: body.assigned_agent_id,
      });
      return json({ task: updated });
    }

    // POST /api/v1/agent-lobby/lobbies/:id/tasks/:taskId/complete
    const completeMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/tasks\/([^/]+)\/complete$/);
    if (completeMatch && req.method === 'POST') {
      const lobbyId = completeMatch[1];
      const taskId = completeMatch[2];
      const body = await readBody(req);
      const task = await store.getMarketplaceTask(lobbyId, taskId);
      if (!task) return json({ error: 'task not found' }, 404);
      
      const updated = await store.updateMarketplaceTask(lobbyId, taskId, {
        status: 'completed',
        tx_hash: typeof body.tx_hash === 'string' ? body.tx_hash : undefined,
        release_signature: typeof body.release_signature === 'string' ? body.release_signature : undefined,
      });
      await recordEvent(lobbyId, 'task_updated', task.posted_by_identity_ref, {
        task_id: taskId,
        status: 'completed',
        release_signed: Boolean(body.release_signature),
      });
      return json({ task: updated });
    }

    // Static file serving fallback for local preview/dashboard
    const MIME_TYPES: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.svg': 'image/svg+xml; charset=utf-8',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    };

    // ── Hosted full Agent OS Panel (Phase 1) ──
    // Serve the Agent OS Panel SPA under /panel so the hosted lobby offers the full panel experience
    // (all sub-menus), not just the Hosted-Mode widget. A hosted-mode flag is injected into the
    // panel's index.html so the SPA adapts (routes its data at the lobby, hides local-only views).
    // The panel's hosted backend (roster/agents/tasks/identity → lobby + hosted-agents) is wired
    // view-by-view in subsequent phases; see docs/hosted-panel.md.
    if (path === '/panel' || path === '/panel/' || path.startsWith('/panel/')) {
      const panelDir = resolve(fileURLToPath(import.meta.url), '../../../../agent-os-panel');
      const rel = path === '/panel' || path === '/panel/' ? 'index.html' : path.slice('/panel/'.length);
      const panelPath = resolve(panelDir, rel);
      if ((panelPath === panelDir || panelPath.startsWith(panelDir + sep)) && existsSync(panelPath) && statSync(panelPath).isFile()) {
        const ext = extname(panelPath);
        const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
        if (ext === '.html') {
          // Inject the hosted-mode flag (+ lobby origin) so the panel SPA runs in hosted mode.
          const html = readFileSync(panelPath, 'utf-8').replace(
            /<head>/i,
            `<head>\n<script>window.AGENT_OS_HOSTED=true;window.AGENT_OS_LOBBY_ORIGIN=location.origin;</script>`,
          );
          res.writeHead(200, { 'content-type': mime, 'access-control-allow-origin': '*' });
          res.end(html);
        } else {
          res.writeHead(200, { 'content-type': mime, 'access-control-allow-origin': '*' });
          res.end(readFileSync(panelPath));
        }
        return;
      }
      // SPA fallback for /panel/<tab> routes → serve the panel index.
      const indexPath = resolve(panelDir, 'index.html');
      if (existsSync(indexPath)) {
        const html = readFileSync(indexPath, 'utf-8').replace(
          /<head>/i,
          `<head>\n<script>window.AGENT_OS_HOSTED=true;window.AGENT_OS_LOBBY_ORIGIN=location.origin;</script>`,
        );
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' });
        res.end(html);
        return;
      }
    }

    const rootDir = resolve(fileURLToPath(import.meta.url), '../../../../apps/lobby-web');
    let filePath = path === '/' ? '/index.html' : path;
    const fullPath = resolve(rootDir, filePath.startsWith('/') ? filePath.slice(1) : filePath);

    if ((fullPath === rootDir || fullPath.startsWith(rootDir + sep)) && existsSync(fullPath) && statSync(fullPath).isFile()) {
      const ext = extname(fullPath);
      const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': mime, 'access-control-allow-origin': '*' });
      res.end(readFileSync(fullPath));
      return;
    }

    json({ error: 'not found' }, 404);
  }

  // ── WebSocket agent protocol ──
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });
  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const lobbyId = url.searchParams.get('lobby_id') ?? defaultLobbyId ?? '';
    const orgId = url.searchParams.get('org_id') ?? 'default';
    const conn: Connection = { connId: randomUUID(), lobbyId, orgId };
    sockets.set(conn.connId, socket);
    if (!lobbyConns.has(lobbyId)) lobbyConns.set(lobbyId, new Set());
    lobbyConns.get(lobbyId)!.add(conn.connId);

    socket.on('message', async (data: Buffer) => {
      let msg: AgentToLobbyMessage;
      try {
        msg = JSON.parse(data.toString()) as AgentToLobbyMessage;
      } catch {
        send(conn.connId, { type: 'lobby-error', error: 'invalid JSON' });
        return;
      }
      const before = conn.agentId;
      const result = await coordinator.handle(conn, msg);
      if (conn.agentId && conn.agentId !== before) agentConn.set(conn.agentId, conn.connId); // learn id on register
      dispatch(conn, result.out);
      if (result.close) socket.close();
    });

    socket.on('close', async () => {
      const result = await coordinator.onDisconnect(conn);
      dispatch(conn, result.out);
      sockets.delete(conn.connId);
      lobbyConns.get(lobbyId)?.delete(conn.connId);
      if (conn.agentId) agentConn.delete(conn.agentId);
    });
  });

  if (autoDefault) await ensureDefaultLobby();

  // ── Stale-heartbeat sweeper ──
  const sweeper = setInterval(() => {
    void (async () => {
      try {
        for (const { lobbyId: reapLobbyId, reapedAgentIds, out } of await coordinator.reapStale(STALE_MS)) {
          dispatch({ connId: '', lobbyId: reapLobbyId, orgId: 'default' }, out);
          for (const agentId of reapedAgentIds) {
            const cid = agentConn.get(agentId);
            if (cid) {
              sockets.get(cid)?.terminate();
              sockets.delete(cid);
              lobbyConns.get(reapLobbyId)?.delete(cid);
              agentConn.delete(agentId);
            }
            console.log(`[lobby-server] reaped stale agent ${agentId} from lobby ${reapLobbyId}`);
          }
        }
      } catch (e) {
        console.error('[lobby-server] stale sweep failed:', e);
      }
    })();
  }, SWEEP_MS);
  if (typeof sweeper.unref === 'function') sweeper.unref();

  const port = options.port ?? DEFAULT_PORT;
  await new Promise<void>((resolve) => httpServer.listen(port, resolve));

  return {
    port,
    store,
    httpServer,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweeper);
        for (const s of sockets.values()) s.terminate();
        wss.close(() => httpServer.close(() => resolve()));
      }),
  };
}

const MAX_BODY_BYTES = 1_048_576; // 1 MiB — no lobby control-plane payload is legitimately larger

async function readBody(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      return {};
    }
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return {};
  }
}

// ── CLI entry ──
const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  // Populate process.env from a repo-root `.env` (real env wins) so AGENT_OS_LOBBY_PORT and
  // AGENT_OS_CONCORDIUM_INDEXER_URL apply when the lobby runs standalone. Only when run as the CLI —
  // library consumers (apps/lobby-web, tests) manage their own environment.
  loadEnv(resolve(import.meta.dirname, '../../..'));
  const portIdx = process.argv.indexOf('--port');
  const port = portIdx >= 0 ? Number(process.argv[portIdx + 1]) : Number(process.env.AGENT_OS_LOBBY_PORT ?? DEFAULT_PORT);
  startLobbyServer({ port })
    .then((s) => {
      console.log(`Agent OS Lobby server`);
      console.log(`  Dashboard: http://localhost:${s.port}/`);
      console.log(`  WebSocket: ws://localhost:${s.port}${WS_PATH}`);
      console.log(`  Discover:  http://localhost:${s.port}/api/v1/agent-lobby/discover`);
      console.log(`  Mode:      in-memory store (portable Node WS — set a Redis store for swarm durability)`);
    })
    .catch((err) => {
      console.error('lobby server failed to start:', err);
      process.exit(1);
    });
}
