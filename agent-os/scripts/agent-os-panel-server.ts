#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen
/**
 * Agent OS Panel — localhost web server for full agent orchestration control plane.
 * Serves a multi-tab SPA dashboard: Agents, Scheduled Tasks, Lobby, Messages,
 * Tasks (Kanban), UI Assist (Chat/Tasks/Sprint), and Gantt Chart.
 *
 * Uses node:http + ws (no Express, no framework).
 *
 * Usage:
 *   npx tsx agent-os/scripts/agent-os-panel-server.ts [--port 4800] [--lobby <url>]
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync,
  appendFileSync, statSync, watch,
} from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { hostname, platform } from 'node:os';

// Node v24 on Windows cannot spawn .cmd files (EINVAL). Use node + tsx CLI module directly.
const TSX_CLI = join(resolve(import.meta.dirname ?? __dirname, '../..'), 'node_modules/tsx/dist/cli.mjs');

function spawnTsx(args: string[], opts: import('node:child_process').SpawnOptions): ChildProcess {
  return spawn(process.execPath, [TSX_CLI, ...args], opts);
}

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { runtimeRegistry } from '@agent-os/adapters';
import { providerRegistry, loadProviderConfigsFromEnv, defaultProviderId, redactProviderConfig } from '@agent-os/providers';
import { loadEnv } from '@agent-os/protocol-core';
import { LobbyClient } from '@agent-os/lobby-client';
import { validateAgentCard, hashAgentCard, prepareRegistration } from '@agent-os/identity-concordium';
import {
  LoopOrchestrator, LOOP_PRESETS,
  type LoopEvent, type CriterionResult, type IterationWork, type CheckpointAction, type BudgetUsed,
} from '@agent-os/loop';

// ── Config ──
const REPO_ROOT = resolve(import.meta.dirname ?? __dirname, '../..');
// Populate process.env from a repo-root `.env` before reading any config (real env always wins).
loadEnv(REPO_ROOT);

// Precedence for each setting: explicit CLI flag → `.env` / environment → built-in default.
const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : Number(process.env.AGENT_OS_PANEL_PORT) || 4800;
const lobbyIdx = args.indexOf('--lobby');
const DEFAULT_LOBBY_URL = lobbyIdx >= 0 ? args[lobbyIdx + 1] : (process.env.AGENT_OS_LOBBY_URL || '');
const NO_RELAY = args.includes('--no-relay');
const RELAY_PORT_IDX = args.indexOf('--relay-port');
const RELAY_PORT = RELAY_PORT_IDX >= 0 ? parseInt(args[RELAY_PORT_IDX + 1], 10) : Number(process.env.AGENT_OS_RELAY_PORT) || 4722;
const PANEL_ID = `${hostname()}-${PORT}`; // Unique identifier for this panel instance
const AGENTS_DIR = join(REPO_ROOT, 'agent-os/sub-agents/agents');
const PANEL_DIR = join(REPO_ROOT, 'agent-os-panel');
const SHARED_MEM_DIR = join(REPO_ROOT, 'agent-os/shared-memory');
const OBS_FILE = join(REPO_ROOT, 'agent-os/observations/current-session.jsonl');
const TASKS_FILE = join(REPO_ROOT, 'agent-os/shared-memory/tasks.jsonl');
const BUS_FILE = join(REPO_ROOT, 'agent-os/shared-memory/bus.jsonl');
const LOGS_DIR = join(REPO_ROOT, 'agent-os/logs');
const PROCESS_STATE = join(SHARED_MEM_DIR, 'state/panel-processes.json');
const SCHEDULED_DIR = join(REPO_ROOT, 'agent-os/scheduled');
const SCHEDULED_CONFIG = join(SCHEDULED_DIR, 'config.json');
const SCHEDULED_STATE_DIR = join(SCHEDULED_DIR, 'state');
const LOBBY_STATE_FILE = join(SHARED_MEM_DIR, 'state/lobby-state.json');
const PHASES_DIR = join(REPO_ROOT, 'docs/product/phases');
const PLAN_DIR = join(REPO_ROOT, '.plan');

// ── MIME Types ──
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Ensure directories
for (const dir of [LOGS_DIR, join(SHARED_MEM_DIR, 'state'), SCHEDULED_STATE_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── WebSocket Support (using ws package for proper frame handling) ──
import { WebSocketServer, WebSocket } from 'ws';

const wsClients = new Set<WebSocket>();
let wss: WebSocketServer;

function broadcastWs(type: string, data: unknown): void {
  const msg = JSON.stringify({ type, data, ts: new Date().toISOString() });
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(msg); } catch { wsClients.delete(client); }
    }
  }
}

// ── Loop Mode (Phase 11) — simulated run registry ──
// Runs use the real @agent-os/loop engine with deterministic in-process seams (no live gate
// skills/lobby) — the same simulation as `npm run loop`. The real evaluate/delegate wiring rides
// on the relay-driver refactor (see docs/loop-mode.md). Events stream over WS as `loop-event`.
interface PanelLoopRun {
  id: string; preset: string; goal: string; status: string;
  iterations: number; passing: number; total: number; attended: boolean; killed: boolean;
  paused?: boolean;
  pendingCheckpoint?: CheckpointAction;
  budgetUsed?: BudgetUsed;
  criteriaResults?: CriterionResult[];
}
const loopRuns = new Map<string, PanelLoopRun>();
let loopRunSeq = 0;

const pausedResolvers = new Map<string, () => void>();
const pendingApprovals = new Map<string, (approved: boolean) => void>();

function checkPause(runId: string): Promise<void> {
  const run = loopRuns.get(runId);
  if (run?.paused) {
    return new Promise<void>((resolve) => {
      pausedResolvers.set(runId, resolve);
    });
  }
  return Promise.resolve();
}

function startLoopRun(presetName: string, unattended: boolean): { ok: boolean; id?: string; error?: string } {
  const preset = LOOP_PRESETS[presetName];
  if (!preset) return { ok: false, error: `unknown preset "${presetName}"` };
  const spec = preset.build();
  const total = spec.exitCriteria.length;
  const id = `loop-${Date.now()}-${++loopRunSeq}`;
  const run: PanelLoopRun = { id, preset: presetName, goal: spec.goal, status: 'running', iterations: 0, passing: 0, total, attended: !unattended, killed: false, paused: false };
  loopRuns.set(id, run);

  const orchestrator = new LoopOrchestrator({
    evaluate: async (ctx): Promise<CriterionResult[]> => {
      await checkPause(id);
      const results: CriterionResult[] = [];
      for (const c of spec.exitCriteria) {
        let passed = false;
        try {
          if (c.type === 'tests') {
            execSync('npm run verify-all', { cwd: REPO_ROOT, stdio: 'pipe' });
            passed = true;
          } else if (c.type === 'gate' && c.skill) {
            execSync(`npm run ${c.skill}`, { cwd: REPO_ROOT, stdio: 'pipe' });
            passed = true;
          } else if (c.type === 'assertion' && c.expr) {
            execSync(c.expr, { cwd: REPO_ROOT, stdio: 'pipe' });
            passed = true;
          } else if (c.type === 'review') {
            passed = false; // Evaluated manually via human approval
          }
        } catch {
          passed = false;
        }
        results.push({ criterion: c, passed });
      }
      run.criteriaResults = results;
      run.budgetUsed = { ...ctx.budgetUsed };
      return results;
    },
    delegate: async (ctx, gap): Promise<IterationWork> => {
      await checkPause(id);
      const runtimeId = (process.env.AGENT_OS_RUNTIME as any) || 'claude-cli';
      const adapter = runtimeRegistry.get(runtimeId) || runtimeRegistry.get('claude-cli')!;
      let summary = '';
      try {
        const handle = await adapter.startAgent({
          cwd: REPO_ROOT,
          systemPrompt: `You are UI Assist in Loop Mode.
Goal: ${spec.goal}

Please resolve the following exit criteria gaps:
${gap.map(g => `- Type: ${g.type}, Detail: ${JSON.stringify(g)}`).join('\n')}

Fix the issues in the workspace files directly and exit once resolved.`,
        });

        await adapter.sendInput(handle, { type: 'user', content: '' });

        for await (const message of adapter.readOutput(handle)) {
          await checkPause(id);
          if (run.killed) {
            await adapter.stopAgent(handle).catch(() => {});
            break;
          }
          if (message.type === 'output' && message.content) {
            summary += message.content;
          }
        }
        await adapter.stopAgent(handle).catch(() => {});
      } catch (err: any) {
        summary = `Delegation failed: ${err.message || err}`;
      }

      const work: IterationWork = {
        tokensUsed: 200,
        costUSD: 0.02,
        summary: summary.slice(0, 200) || `delegated to ${adapter.label}`,
        requestedActions: ['commit'] as CheckpointAction[]
      };
      run.budgetUsed = { ...ctx.budgetUsed };
      return work;
    },
    approveCheckpoint: (ctx, action): Promise<boolean> => {
      run.status = 'awaiting_checkpoint';
      run.pendingCheckpoint = action;
      broadcastWs('loop-event', { id, type: 'checkpoint_requested', iteration: run.iterations, message: action });
      return new Promise<boolean>((resolve) => {
        pendingApprovals.set(id, (approved) => {
          run.pendingCheckpoint = undefined;
          run.status = 'running';
          resolve(approved);
        });
      });
    },
    isKilled: () => run.killed,
    emit: (e: LoopEvent) => {
      run.iterations = e.iteration;
      if (e.passing != null) { run.passing = e.passing; run.total = e.total ?? total; }
      broadcastWs('loop-event', { id, type: e.type, iteration: e.iteration, message: e.message, passing: e.passing, total: e.total });
    },
  });
  orchestrator.run(spec, { allowUnattended: unattended, unattendedAllowlist: [...preset.unattendedAllowlist] })
    .then((res) => {
      run.status = res.status;
      run.passing = res.passing;
      run.total = res.total;
      run.iterations = res.iterations;
      run.budgetUsed = res.budgetUsed;
      run.criteriaResults = res.results;
      broadcastWs('loop-done', { id, status: res.status, passing: res.passing, total: res.total, iterations: res.iterations });
    })
    .catch((err) => {
      run.status = 'error';
      broadcastWs('loop-done', { id, status: 'error', message: String(err) });
    });

  return { ok: true, id };
}

// ── Lobby WebSocket Bridge ──
// Connects to the staging lobby as a browser participant (no auth required).
// Sends messages via WebSocket (REST POST requires auth, but WS doesn't).
let lobbyClient: LobbyClient | null = null;
let lobbyWsConnected = false;

async function connectLobbyWs(): Promise<void> {
  if (!DEFAULT_LOBBY_URL || lobbyWsConnected) return;

  console.log('Lobby WS: resolving lobby...');
  const lobbyId = await resolveLobbyId();
  if (!lobbyId) {
    console.log('Lobby WS: no active lobby found, will retry in 30s');
    setTimeout(connectLobbyWs, 30000);
    return;
  }
  console.log(`Lobby WS: found lobby ${lobbyId}, connecting...`);

  try {
    let joinToken: string | undefined = undefined;
    const cardPath = join(REPO_ROOT, 'agent-card.json');
    if (existsSync(cardPath)) {
      try {
        const card = JSON.parse(readFileSync(cardPath, 'utf-8'));
        if (card.ref) joinToken = card.ref;
      } catch {}
    }

    lobbyClient = new LobbyClient({
      lobbyUrl: DEFAULT_LOBBY_URL,
      lobbyId: lobbyId,
      orgId: cachedOrgId || 'default',
      register: {
        type: 'lobby-register',
        display_name: `Panel-${PANEL_ID}`,
        agent_role: 'panel',
        cwd: REPO_ROOT,
        branch: 'main',
        pid: process.pid,
        relay_port: PORT,
        join_token: joinToken,
      },
      reconnect: true,
    });

    lobbyClient.onMessage((msg) => {
      try {
        if (msg.type === 'lobby-registered') {
          panelAgentId = msg.agent_id;
          lobbyWsConnected = true;
          console.log(`Lobby WS: registered as agent ${msg.agent_id}`);
        }
        if (msg.type === 'lobby-roster') {
          const agents = msg.agents || [];
          for (const a of agents) {
            if (a.agent_id) {
              if (a.display_name) stagingAgentNames.set(a.agent_id, a.display_name);
              stagingAgentRoster.set(a.agent_id, a);
            }
          }
          const boss = agents.find((a: any) => a.is_boss || a.agent_role === 'boss-agent');
          if (boss) {
            lobbyBossAgentId = boss.agent_id;
            console.log(`Lobby WS: boss agent is ${lobbyBossAgentId} (${boss.display_name})`);
          }
          console.log(`Lobby WS: roster received (${agents.length} agents, ${stagingAgentNames.size} names cached)`);
        }
        if (msg.type === 'lobby-boss-appointed') {
          lobbyBossAgentId = msg.agent_id || msg.boss_agent_id;
          console.log(`Lobby WS: boss agent set to ${lobbyBossAgentId}`);
          try {
            const stateFile = existsSync(LOBBY_STATE_FILE) ? JSON.parse(readFileSync(LOBBY_STATE_FILE, 'utf-8')) : {};
            stateFile.bossAgentSlug = lobbyBossAgentId;
            writeFileSync(LOBBY_STATE_FILE, JSON.stringify(stateFile, null, 2));
          } catch { /* ignore */ }
          broadcastWs('lobby-boss-update', { agent_id: lobbyBossAgentId, type: 'appointed' });
        }
        if (msg.type === 'lobby-boss-lost') {
          console.log(`Lobby WS: boss agent lost (was ${lobbyBossAgentId})`);
          lobbyBossAgentId = null;
          try {
            const stateFile = existsSync(LOBBY_STATE_FILE) ? JSON.parse(readFileSync(LOBBY_STATE_FILE, 'utf-8')) : {};
            stateFile.bossAgentSlug = null;
            writeFileSync(LOBBY_STATE_FILE, JSON.stringify(stateFile, null, 2));
          } catch { /* ignore */ }
          broadcastWs('lobby-boss-update', { agent_id: null, type: 'lost' });
        }
        if (msg.type === 'lobby-error') {
          console.log(`Lobby WS: server error: ${msg.error}`);
        }
        if (msg.type === 'lobby-message-received') {
          const lobbyMsg = msg.message || msg;
          broadcastWs('lobby-message', lobbyMsg);
          if (lobbyMsg.content) {
            const fromName = lobbyMsg.from_display_name || stagingAgentNames.get(lobbyMsg.from_agent_id) || lobbyMsg.from_agent_id || '?';
            const toName = lobbyMsg.to_agent_id === 'all' ? '*' : (lobbyMsg.to_display_name || stagingAgentNames.get(lobbyMsg.to_agent_id) || lobbyMsg.to_agent_id || '*');
            const localMsg = {
              id: lobbyMsg.message_id || `msg-${Date.now()}`,
              timestamp: lobbyMsg.created_at || new Date().toISOString(),
              from: fromName,
              from_agent_id: lobbyMsg.from_agent_id,
              from_display_name: fromName,
              to: toName,
              to_agent_id: lobbyMsg.to_agent_id,
              to_display_name: toName,
              type: lobbyMsg.message_type || 'chat',
              message_type: lobbyMsg.message_type || 'chat',
              content: lobbyMsg.content,
              source: 'lobby',
            };
            appendFileSync(BUS_FILE, JSON.stringify(localMsg) + '\n');
          }
        }
        if (msg.type === 'lobby-agent-joined' || msg.type === 'lobby-agent-left' ||
            msg.type === 'lobby-agent-updated') {
          const agent = msg.agent || msg;
          if (agent.agent_id) {
            if (agent.display_name) stagingAgentNames.set(agent.agent_id, agent.display_name);
            if (msg.type === 'lobby-agent-left') {
              stagingAgentRoster.delete(agent.agent_id);
            } else {
              stagingAgentRoster.set(agent.agent_id, agent);
            }
          }
          broadcastWs('lobby-agent-update', msg);
        }
        if (msg.type === 'lobby-hand-raised') {
          broadcastWs('lobby-message', {
            message_id: `msg-${Date.now()}`,
            from_agent_id: 'system',
            to_agent_id: 'all',
            message_type: 'system',
            content: `🤚 **${msg.hand?.display_name || msg.hand?.agent_name || msg.agent_id || '?'}** raised hand [${msg.hand?.category || 'general'}]: ${msg.hand?.reason || ''}`,
            created_at: new Date().toISOString(),
          });
          const handRequest = {
            request_id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            agent_id: msg.hand?.agent_id || msg.agent_id,
            agent_display_name: msg.hand?.display_name || msg.hand?.agent_name || msg.agent_id,
            title: `HAND: ${msg.hand?.display_name || msg.hand?.agent_name || '?'} — ${msg.hand?.category || 'general'}`,
            description: msg.hand?.reason || '',
            category: 'hand_raise',
            status: 'pending',
            created_at: new Date().toISOString(),
          };
          localLobbyRequests.push(handRequest);
          broadcastWs('lobby-request', handRequest);
        }
        if (msg.type === 'lobby-request-created' || msg.type === 'lobby-request-updated') {
          const req = msg.request || msg;
          if (req.request_id) localLobbyRequests.push(req);
          broadcastWs('lobby-request', req);
        }
        if (msg.type === 'lobby-request-decided') {
          broadcastWs('lobby-request-decided', msg.request || msg);
        }
        if (msg.type === 'lobby-task-assigned' || msg.type === 'lobby-task-updated') {
          broadcastWs('lobby-task-update', msg);
          const task = msg.task;
          if (task?.task_id) {
            const localTask = {
              task_id: task.task_id,
              title: task.title || 'Untitled',
              description: task.description || '',
              status: task.status || 'pending',
              priority: task.priority || 'normal',
              assigned_to: task.assigned_to || '',
              category: task.category || 'general',
              created_at: task.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
              source: 'lobby',
            };
            appendFileSync(TASKS_FILE, JSON.stringify(localTask) + '\n');
          }
        }
      } catch { /* ignore */ }
    });

    await lobbyClient.connect();
    lobbyWsConnected = true;
    console.log('Lobby WS: connected via LobbyClient');
  } catch (err) {
    console.error('Lobby WS: failed to connect:', err);
    lobbyWsConnected = false;
    setTimeout(connectLobbyWs, 10000);
  }
}

// Track our agent_id and the boss agent_id from the lobby
let panelAgentId: string | null = null;
let lobbyBossAgentId: string | null = null;

// Cached staging agent roster (ULID → display_name) — updated from WS events
const stagingAgentNames = new Map<string, string>();
// Full staging agent objects — for lobby tab roster display
const stagingAgentRoster = new Map<string, Record<string, unknown>>();

// ── Local Lobby State (persisted to JSON, used when no --lobby URL) ──
// Active lobby URL: empty = local mode, filled = swarm mode
let activeLobbyUrl = DEFAULT_LOBBY_URL;
let localLobbyBossId: string | null = null;
const localLobbyAgents = new Map<string, { agent_id: string; display_name: string; agent_role: string; status: string; current_work: string; cwd?: string; branch?: string; relay_port?: number; pid?: number; last_heartbeat: string }>();
const localLobbyAgentConns = new Map<string, WebSocket>(); // agent_id → WS
const localLobbyMessages: Array<Record<string, unknown>> = []; // capped at 500
const localLobbyTasks: Array<Record<string, unknown>> = [];
const localLobbyRequests: Array<Record<string, unknown>> = [];
const LOCAL_LOBBY_STATE_FILE = join(SHARED_MEM_DIR, 'state/local-lobby.json');

// Restore local lobby state on startup
try {
  if (existsSync(LOCAL_LOBBY_STATE_FILE)) {
    const saved = JSON.parse(readFileSync(LOCAL_LOBBY_STATE_FILE, 'utf-8'));
    if (saved.messages) localLobbyMessages.push(...saved.messages.slice(-200));
    if (saved.tasks) localLobbyTasks.push(...saved.tasks);
    if (saved.bossRole) localLobbyBossId = null; // boss ID changes per session, but we remember the role
    console.log(`Local lobby: restored ${localLobbyMessages.length} messages, ${localLobbyTasks.length} tasks from state file`);
  }
} catch { /* ignore */ }

function saveLocalLobbyState(): void {
  try {
    writeFileSync(LOCAL_LOBBY_STATE_FILE, JSON.stringify({
      messages: localLobbyMessages.slice(-200),
      tasks: localLobbyTasks,
      bossId: localLobbyBossId,
      savedAt: new Date().toISOString(),
    }, null, 2));
  } catch { /* ignore */ }
}

function sendLobbyMessage(content: string, toAgentId = 'all', messageType = 'chat'): boolean {
  // ── Local mode: route through local lobby directly ──
  if (!activeLobbyUrl) {
    const bossId = localLobbyBossId || lobbyBossAgentId;
    const target = toAgentId === 'all' ? bossId : toAgentId;
    if (!target) {
      console.log('Local lobby: no boss agent — message not delivered');
      return false;
    }
    const conn = localLobbyAgentConns.get(target);
    if (conn && conn.readyState === WebSocket.OPEN) {
      const lobbyMsg = {
        message_id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        from_agent_id: panelAgentId || `Panel-${hostname()}-${PORT}`,
        to_agent_id: target,
        message_type: messageType,
        content,
        created_at: new Date().toISOString(),
        from_display_name: `Panel-${hostname()}-${PORT}`,
        to_display_name: localLobbyAgents.get(target)?.display_name || target,
      };
      localLobbyMessages.push(lobbyMsg);
      if (localLobbyMessages.length > 500) localLobbyMessages.splice(0, localLobbyMessages.length - 500);
      conn.send(JSON.stringify({ type: 'lobby-message-received', message: lobbyMsg }));
      broadcastWs('lobby-message', lobbyMsg);
      return true;
    }
    console.log(`Local lobby: agent ${target} not connected`);
    return false;
  }

  // ── Swarm mode: route through staging lobby WS ──
  if (!lobbyClient || !lobbyWsConnected) return false;
  try {
    let target = toAgentId;
    if (target === 'all') {
      if (lobbyBossAgentId) {
        target = lobbyBossAgentId;
      } else {
        console.log('Lobby: no boss agent known — sending as HAND raise');
        lobbyClient.send({
          type: 'lobby-message',
          content: `HAND ${panelAgentId ?? 'panel'} — needs_assignment: ${content}`,
          to_agent_id: 'all',
          message_type: messageType as any,
        });
        return true;
      }
    }
    lobbyClient.send({
      type: 'lobby-message',
      content,
      to_agent_id: target,
      message_type: messageType as any,
    });
    return true;
  } catch { return false; }
}

// ── File Watchers → WebSocket Push ──
function watchFile(path: string, type: string): void {
  if (!existsSync(path)) return;
  try {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const watcher = watch(path, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        try {
          const lines = readJsonlTail(path, 10);
          broadcastWs(type, lines.map(l => { try { return JSON.parse(l); } catch { return l; } }));
        } catch { /* ignore */ }
      }, 300);
    });
    // Prevent EPERM crash on Windows when watched file is replaced/renamed
    watcher.on('error', () => { /* ignore — watcher will be re-established if needed */ });
  } catch { /* ignore — file may not exist yet */ }
}

// ── Agent Registry ──
interface AgentDef {
  slug: string;
  name: string;
  scope: string;
  file: string;
}

interface RunningAgent {
  slug: string;
  pid: number;
  startedAt: string;
  lobbyUrl: string;
}

const runningProcesses = new Map<string, ChildProcess>();
let runningAgents: Record<string, RunningAgent> = {};

// Load persisted state
if (existsSync(PROCESS_STATE)) {
  try {
    runningAgents = JSON.parse(readFileSync(PROCESS_STATE, 'utf-8'));
  } catch { /* ignore */ }
}

function saveProcessState(): void {
  const state: Record<string, RunningAgent> = {};
  for (const [slug, info] of Object.entries(runningAgents)) {
    if (runningProcesses.has(slug)) {
      state[slug] = info;
    }
  }
  writeFileSync(PROCESS_STATE, JSON.stringify(state, null, 2));
}

function discoverAgents(): AgentDef[] {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const content = readFileSync(join(AGENTS_DIR, f), 'utf-8');
      const titleMatch = content.match(/^Title:\s*(.+)$/m);
      const scopeMatch = content.match(/^Scope:\s*(.+)$/m);
      const slugMatch = content.match(/^Slug:\s*(.+)$/m);
      return {
        slug: slugMatch?.[1]?.trim() ?? f.replace('.md', ''),
        name: titleMatch?.[1]?.trim() ?? f.replace('.md', ''),
        scope: scopeMatch?.[1]?.trim() ?? '',
        file: f,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getAgentStatus(slug: string): string {
  if (runningProcesses.has(slug)) {
    const proc = runningProcesses.get(slug)!;
    if (proc.exitCode === null && !proc.killed) return 'running';
    runningProcesses.delete(slug);
    delete runningAgents[slug];
    saveProcessState();
    return 'stopped';
  }
  return 'stopped';
}

function startAgent(slug: string, lobbyUrl: string): { ok: boolean; error?: string } {
  if (runningProcesses.has(slug)) {
    return { ok: false, error: `Agent ${slug} is already running` };
  }

  const relayPath = join(REPO_ROOT, 'packages/relay/src/relay-server.ts');
  if (!existsSync(relayPath)) {
    return { ok: false, error: 'relay-server.ts not found' };
  }

  // Assign a unique port per agent (4730 + offset based on agent index)
  const agentIndex = discoverAgents().findIndex(a => a.slug === slug);
  const agentPort = 4730 + (agentIndex >= 0 ? agentIndex : runningProcesses.size);

  // Determine effective lobby URL: use provided, or fall back to local lobby
  const effectiveLobbyUrl = lobbyUrl || `http://localhost:${PORT}`;
  const isLocalLobby = !lobbyUrl || effectiveLobbyUrl.includes(`localhost:${PORT}`);
  const displayName = isLocalLobby ? slug : `${hostname()}-${slug}-${PORT}`;
  const agentArgs = [relayPath, '--port', String(agentPort), '--agent-name', displayName, '--agent-role', slug];
  agentArgs.push('--lobby', effectiveLobbyUrl);

  const logFile = join(LOGS_DIR, `${slug}.log`);

  try {
    const proc = spawnTsx(agentArgs, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const logLines: string[] = [];
    const appendLog = (data: Buffer) => {
      const lines = data.toString().split('\n');
      logLines.push(...lines);
      if (logLines.length > 500) logLines.splice(0, logLines.length - 500);
      try { writeFileSync(logFile, logLines.join('\n')); } catch { /* ignore */ }
    };

    proc.stdout?.on('data', appendLog);
    proc.stderr?.on('data', appendLog);

    proc.on('exit', () => {
      runningProcesses.delete(slug);
      delete runningAgents[slug];
      saveProcessState();
      broadcastWs('agent-exit', { slug });
    });

    runningProcesses.set(slug, proc);
    runningAgents[slug] = {
      slug,
      pid: proc.pid ?? 0,
      startedAt: new Date().toISOString(),
      lobbyUrl,
    };
    saveProcessState();
    broadcastWs('agent-start', { slug, pid: proc.pid });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function stopAgent(slug: string): { ok: boolean; error?: string } {
  const proc = runningProcesses.get(slug);
  if (!proc) return { ok: false, error: `Agent ${slug} is not running` };

  proc.kill('SIGTERM');
  setTimeout(() => {
    if (proc.exitCode === null) proc.kill('SIGKILL');
  }, 5000);

  runningProcesses.delete(slug);
  delete runningAgents[slug];
  saveProcessState();
  return { ok: true };
}

// ── Scheduled Task Management ──
interface ScheduledProcess {
  name: string;
  pid: number;
  startedAt: string;
}
const scheduledProcesses = new Map<string, ChildProcess>();
const scheduledState: Record<string, ScheduledProcess> = {};

function getScheduledConfig(): Record<string, unknown> {
  if (!existsSync(SCHEDULED_CONFIG)) return {};
  try { return JSON.parse(readFileSync(SCHEDULED_CONFIG, 'utf-8')); } catch { return {}; }
}

function getScheduledTaskState(name: string): Record<string, unknown> | null {
  const stateMap: Record<string, string> = {
    'graph-update': 'last-graph-update.json',
    'pr-quality-review': 'last-review.json',
    'fix-sprint-executor': 'last-executor.json',
  };
  const file = join(SCHEDULED_STATE_DIR, stateMap[name] ?? `last-${name}.json`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return null; }
}

function triggerScheduledTask(name: string): { ok: boolean; error?: string } {
  if (scheduledProcesses.has(name)) {
    return { ok: false, error: `Task ${name} is already running` };
  }

  const config = getScheduledConfig() as { schedules?: Record<string, { prompt?: string }> };
  const taskConfig = config.schedules?.[name];
  if (!taskConfig) return { ok: false, error: `Unknown task: ${name}` };

  const promptPath = join(SCHEDULED_DIR, taskConfig.prompt ?? `prompts/${name}.md`);
  if (!existsSync(promptPath)) return { ok: false, error: `Prompt not found: ${promptPath}` };

  const prompt = readFileSync(promptPath, 'utf-8');
  const logFile = join(LOGS_DIR, `scheduled-${name}.log`);

  try {
    // Spawn as a node process that runs the prompt via Claude Code
    // Use shell:true with single string command to avoid Node v24 DEP0190 warning
    const proc = spawn('claude --print --dangerously-skip-permissions', {
      shell: true,
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'], // stdin open for prompt
      detached: false,
      timeout: 30 * 60 * 1000, // 30 min timeout
    });

    // Write prompt via stdin (avoids "command line too long" on Windows)
    proc.stdin?.write(prompt);
    proc.stdin?.end();

    const logLines: string[] = [];
    const appendLog = (data: Buffer) => {
      const lines = data.toString().split('\n');
      logLines.push(...lines);
      if (logLines.length > 1000) logLines.splice(0, logLines.length - 1000);
      try { writeFileSync(logFile, logLines.join('\n')); } catch { /* ignore */ }
    };

    proc.stdout?.on('data', appendLog);
    proc.stderr?.on('data', appendLog);

    proc.on('exit', (code) => {
      scheduledProcesses.delete(name);
      delete scheduledState[name];
      // Update the last-run state file so "Last run" reflects this manual trigger
      const stateMap: Record<string, string> = {
        'graph-update': 'last-graph-update.json',
        'pr-quality-review': 'last-review.json',
        'fix-sprint-executor': 'last-executor.json',
      };
      const stateFile = join(SCHEDULED_STATE_DIR, stateMap[name] ?? `last-${name}.json`);
      try {
        const existing = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf-8')) : {};
        // Read last few lines of log for error context
        const logFile = join(LOGS_DIR, `scheduled-${name}.log`);
        let errorSnippet = '';
        if (code !== 0 && existsSync(logFile)) {
          const logContent = readFileSync(logFile, 'utf-8');
          const logLines = logContent.split('\n').filter(l => l.trim());
          errorSnippet = logLines.slice(-5).join('\n');
        }
        writeFileSync(stateFile, JSON.stringify({
          ...existing,
          last_run: new Date().toISOString(),
          status: code === 0 ? 'success' : 'failed',
          exit_code: code,
          triggered_by: 'panel-run-now',
          ...(errorSnippet ? { error_snippet: errorSnippet } : {}),
        }, null, 2));
      } catch { /* ignore */ }
      broadcastWs('scheduled-done', { name, code });
    });

    scheduledProcesses.set(name, proc);
    scheduledState[name] = { name, pid: proc.pid ?? 0, startedAt: new Date().toISOString() };
    broadcastWs('scheduled-start', { name, pid: proc.pid });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Remote Lobby Proxy ──
// Fetches the full agent roster from the remote staging lobby (if configured)
function fetchRemoteLobbyRoster(lobbyUrl: string): Promise<unknown> {
  return new Promise((resolve) => {
    if (!lobbyUrl) { resolve({ agents: [], error: 'No lobby URL configured' }); return; }

    try {
      const url = new URL('/api/v1/agent-lobby/discover', lobbyUrl);
      const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;

      const req = reqFn(url, { timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk; });
        res.on('end', () => {
          try {
            const discovery = JSON.parse(body);
            // Now fetch agents for the discovered lobby
            const agentsUrl = new URL(
              `/api/v1/agent-lobby/${discovery.lobby_id}/agents`,
              lobbyUrl
            );
            const agentReq = reqFn(agentsUrl, { timeout: 5000 }, (agentRes) => {
              let agentBody = '';
              agentRes.on('data', (chunk: Buffer) => { agentBody += chunk; });
              agentRes.on('end', () => {
                try {
                  const data = JSON.parse(agentBody);
                  resolve({
                    lobby: discovery,
                    agents: data.agents || data || [],
                    panelId: PANEL_ID,
                    totalRemoteAgents: (data.agents || data || []).length,
                  });
                } catch {
                  resolve({ agents: [], lobby: discovery, error: 'Failed to parse agents' });
                }
              });
            });
            agentReq.on('error', () => resolve({ agents: [], error: 'Agent fetch failed' }));
            agentReq.end();
          } catch {
            resolve({ agents: [], error: 'Failed to parse discovery' });
          }
        });
      });
      req.on('error', () => resolve({ agents: [], error: 'Lobby unreachable' }));
      req.on('timeout', () => { req.destroy(); resolve({ agents: [], error: 'Lobby timeout' }); });
      req.end();
    } catch (err) {
      resolve({ agents: [], error: String(err) });
    }
  });
}

// ── Generic Staging API Proxy ──
// Proxies requests to the staging server's REST API (avoids CORS from browser)
function normalizeLobbyHttpUrl(lobbyUrl: string): string {
  if (!lobbyUrl) return '';
  return lobbyUrl.replace(/^ws(s)?:\/\//i, (_, ssl) => ssl ? 'https://' : 'http://');
}

let cachedLobbyId: string | null = null;
let cachedOrgId: string | null = null;

async function discoverLobbyId(lobbyUrl: string): Promise<string | null> {
  if (cachedLobbyId) return cachedLobbyId;
  return new Promise((resolve) => {
    if (!lobbyUrl) { resolve(null); return; }
    try {
      const httpUrl = normalizeLobbyHttpUrl(lobbyUrl);
      const url = new URL('/api/v1/agent-lobby/discover', httpUrl);
      const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = reqFn(url, { timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            // Response is { lobby: { lobby_id, org_id, name } | null }
            cachedLobbyId = data.lobby?.lobby_id || data.lobby_id || null;
            cachedOrgId = data.lobby?.org_id || data.org_id || null;
            if (cachedLobbyId) console.log(`Lobby discover: found lobby ${cachedLobbyId}`);
            resolve(cachedLobbyId);
          } catch { resolve(null); }
        });
      });
      req.on('error', (err) => { console.log('Lobby discover error:', (err as Error).message); resolve(null); });
      req.end();
    } catch { resolve(null); }
  });
}

let activeLobbyId: string | null = null;

async function resolveLobbyId(): Promise<string | null> {
  if (activeLobbyId) return activeLobbyId;
  return discoverLobbyId(DEFAULT_LOBBY_URL);
}

function postRemoteJson(remoteUrl: string, path: string, body: any): Promise<any> {
  return new Promise((resolve) => {
    if (!remoteUrl) { resolve({ error: 'No remote URL' }); return; }
    try {
      const httpUrl = normalizeLobbyHttpUrl(remoteUrl);
      const url = new URL(path, httpUrl);
      const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const dataStr = JSON.stringify(body);
      const req = reqFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(dataStr),
        },
        timeout: 5000,
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk: Buffer) => { responseBody += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(responseBody));
          } catch {
            resolve({ error: 'Failed to parse JSON response' });
          }
        });
      });
      req.on('error', (err) => resolve({ error: (err as Error).message }));
      req.write(dataStr);
      req.end();
    } catch (err) {
      resolve({ error: String(err) });
    }
  });
}

function proxyToStaging(lobbyUrl: string, apiPath: string, method = 'GET', body?: string): Promise<unknown> {
  return new Promise((resolve) => {
    if (!lobbyUrl) { resolve({ error: 'No lobby URL configured' }); return; }
    try {
      const httpUrl = normalizeLobbyHttpUrl(lobbyUrl);
      const url = new URL(apiPath, httpUrl);
      const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const opts: import('node:http').RequestOptions = {
        method,
        timeout: 10000,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
      };
      const req = reqFn(url, opts, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
        });
      });
      req.on('error', (err) => resolve({ error: String(err) }));
      req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout' }); });
      if (body) req.write(body);
      req.end();
    } catch (err) { resolve({ error: String(err) }); }
  });
}

// Invalidate lobby cache every 5 minutes
setInterval(() => { cachedLobbyId = null; cachedOrgId = null; }, 300_000);

// ── File readers ──
function readJsonlTail(path: string, n: number): string[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf-8').trim();
  if (!content) return [];
  const lines = content.split('\n').filter(l => l.trim());
  return lines.slice(-n);
}

function readJsonlFiltered(path: string, filters: Record<string, string>, limit = 100): unknown[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf-8').trim();
  if (!content) return [];
  const lines = content.split('\n').filter(l => l.trim());
  const results: unknown[] = [];

  for (let i = lines.length - 1; i >= 0 && results.length < limit; i--) {
    try {
      const obj = JSON.parse(lines[i]) as Record<string, unknown>;
      let match = true;
      for (const [key, val] of Object.entries(filters)) {
        if (val && String(obj[key] ?? '') !== val) { match = false; break; }
      }
      if (match) results.unshift(obj);
    } catch { /* skip malformed lines */ }
  }
  return results;
}

// ── Gantt Data (cached) ──
let ganttCache: { phases: unknown[]; cachedAt: number } | null = null;

function getGanttData(): { phases: unknown[] } {
  if (ganttCache && Date.now() - ganttCache.cachedAt < 60_000) {
    return { phases: ganttCache.phases };
  }

  const liveTasksMap = new Map<string, string>();
  if (existsSync(TASKS_FILE)) {
    try {
      const lines = readFileSync(TASKS_FILE, 'utf-8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const t = JSON.parse(line);
        if (t.title) {
          liveTasksMap.set(t.title.trim().toLowerCase(), t.status);
        }
      }
    } catch {}
  }

  const phases: unknown[] = [];

  if (existsSync(PHASES_DIR)) {
    const phaseDirs = readdirSync(PHASES_DIR)
      .filter(d => d.startsWith('phase-'))
      .sort((a, b) => {
        const na = parseInt(a.replace('phase-', ''));
        const nb = parseInt(b.replace('phase-', ''));
        return na - nb;
      });

    for (const phaseDir of phaseDirs) {
      const phasePath = join(PHASES_DIR, phaseDir);
      const phaseNum = phaseDir.replace('phase-', '');

      // ── Read phase README.md for phase-level status ──
      let phaseStatus = 'unknown';
      let phaseName = `Phase ${phaseNum}`;
      const readmePath = join(phasePath, 'README.md');
      // Count completed sprints from README sprint tables (e.g. "| 22.7.3 | ... | Complete |")
      let readmeCompletedSprints = 0;
      let readmeTotalSprints = 0;
      const sprintStatusMap = new Map<string, string>();

      if (existsSync(readmePath)) {
        const readmeContent = readFileSync(readmePath, 'utf-8');
        // Match various status formats:
        //   | **Status** | Complete |        | **Status** | **Delivered** |
        //   **Status**: Complete — all 8 sprints delivered
        //   > **Status:** Complete            > **Status:** Delivered
        if (/Status[*|:\s]+(Complete|Delivered)/i.test(readmeContent)) {
          phaseStatus = 'complete';
        } else if (/Status[*|:\s]+(In.?Progress|Active|Current)/i.test(readmeContent)) {
          phaseStatus = 'in-progress';
        } else if (/Status[*|:\s]+(Planned|Pending|Not.?Started|Pre.?Plan)/i.test(readmeContent)) {
          phaseStatus = 'planned';
        }

        // Count per-sprint status from README tables (rows like "| 22.7.3 | ... | Complete |")
        // This catches phases where individual sprint status is tracked in the README table
        // Match table rows with status in the last cell — handles:
        //   | **Complete** |   | Complete |   | **Complete** (2026-03-27) |
        const tableRows = readmeContent.match(/^\|[^|]+\|.*\|\s*\*{0,2}(Complete|Delivered|In Progress|Planned|Not Started)\b[^|]*\|/gim);
        if (tableRows) {
          readmeTotalSprints = tableRows.length;
          readmeCompletedSprints = tableRows.filter(r => {
            const cells = r.split('|').map(c => c.trim()).filter(c => c);
            const lastCell = cells[cells.length - 1] || '';
            return /Complete|Delivered/i.test(lastCell);
          }).length;

          // If all sprints in the table are complete, promote phase to complete
          // (overrides "In Progress" in README when all work is actually done)
          if (readmeCompletedSprints === readmeTotalSprints && readmeTotalSprints > 0) {
            phaseStatus = 'complete';
          }
          // If some sprints are complete but not all, mark in-progress
          if (readmeCompletedSprints > 0 && readmeCompletedSprints < readmeTotalSprints && phaseStatus === 'unknown') {
            phaseStatus = 'in-progress';
          }
        }

        // Build sprint ID → status map from the same tableRows that were already matched
        if (tableRows) {
          for (const row of tableRows) {
            const cells = row.split('|').map(c => c.trim()).filter(c => c);
            if (cells.length < 2) continue;
            // Find which cell contains the status keyword
            let rowStatus = '';
            for (const cell of cells) {
              const c = cell.toLowerCase().replace(/\*/g, '');
              if (/\bcomplete\b|\bdelivered\b|\bdone\b/.test(c)) { rowStatus = 'complete'; break; }
              if (/\bin.?progress\b|\bactive\b/.test(c)) { rowStatus = 'in-progress'; break; }
              if (/\bplanned\b|\bpending\b/.test(c)) { rowStatus = 'planned'; break; }
            }
            if (rowStatus) {
              // Extract sprint ID from any cell (usually first)
              for (const cell of cells) {
                const idMatch = cell.match(/(\d+\.\d+\.\d+)/);
                if (idMatch) { sprintStatusMap.set(idMatch[1], rowStatus); break; }
              }
            }
          }
        }

        // Extract phase title from first heading
        const phaseTitle = readmeContent.match(/^#\s+(.+)$/m);
        if (phaseTitle) phaseName = phaseTitle[1].replace(/\s*--\s*/, ' — ').trim();
      }

      // ── Read sprint files (skip README.md and workfiles) ──
      const sprints: unknown[] = [];
      try {
        const files = readdirSync(phasePath)
          .filter(f => f.endsWith('.md') && f !== 'README.md' && !f.includes('workfile') && /sprint-\d/.test(f))
          .sort();

        for (const file of files) {
          const content = readFileSync(join(phasePath, file), 'utf-8');
          const titleMatch = content.match(/^#\s+(.+)$/m);

          // Sprint status resolution order:
          // 1. README table row status (most reliable — manually maintained)
          // 2. Explicit status in sprint file itself
          // 3. Inherit from phase status
          const sprintIdMatch = file.match(/(\d+\.\d+\.\d+)/);
          const readmeStatus = sprintIdMatch ? sprintStatusMap.get(sprintIdMatch[1]) : undefined;

          let sprintStatus = readmeStatus ?? phaseStatus;
          if (!readmeStatus) {
            // Try table format: | **Status** | Complete |
            const tableStatus = content.match(/\|\s*\*?\*?Status\*?\*?\s*\|\s*\*?\*?([^|*\n]+)/i);
            // Try blockquote format: > **Status:** Complete
            const blockquoteStatus = content.match(/>\s*\*?\*?Status\*?\*?:?\s*\*?\*?\s*([^\n*]+)/i);
            const statusVal = (tableStatus?.[1] || blockquoteStatus?.[1] || '').trim().toLowerCase();
            if (statusVal) {
              if (statusVal.includes('complete') || statusVal.includes('delivered')) sprintStatus = 'complete';
              else if (statusVal.includes('progress') || statusVal.includes('active')) sprintStatus = 'in-progress';
              else if (statusVal.includes('plan') || statusVal.includes('pending')) sprintStatus = 'planned';
            }
          }

          // Count acceptance criteria as tasks — supports multiple formats
          const tasks: { title: string; done: boolean }[] = [];
          // Format 1: Checkboxes — - [x] Title / - [ ] Title
          const checkboxMatch = content.match(/^[-*]\s+\[([x ])\]\s+(.+)$/gm);
          if (checkboxMatch) {
            for (const t of checkboxMatch) {
              const m = t.match(/^[-*]\s+\[([x ])\]\s+(.+)$/);
              if (m) tasks.push({ title: m[2], done: m[1] === 'x' });
            }
          }
          // Format 2: Numbered lists — 1. **Title** or 1. Title (only if no checkboxes found)
          if (!tasks.length) {
            const numberedMatch = content.match(/^\d+\.\s+\*?\*?([^*\n][^\n]*)/gm);
            if (numberedMatch) {
              for (const t of numberedMatch) {
                const m = t.match(/^\d+\.\s+\*?\*?([^*\n][^\n]*)\*?\*?\s*$/);
                if (m) {
                  const title = m[1].replace(/\*\*/g, '').trim();
                  // Skip very short items, step numbers, or non-AC patterns
                  if (title.length > 5) tasks.push({ title, done: false });
                }
              }
            }
          }
          // Format 3: AC table rows — | AC-1 | Description | or | 1 | Description |
          if (!tasks.length) {
            const acSection = content.match(/## Acceptance Criteria[\s\S]*?(?=\n## |\n---|\Z)/);
            if (acSection) {
              const tableRows = acSection[0].match(/^\|\s*(?:AC-?\d+|\d+)\s*\|(.+)\|$/gm);
              if (tableRows) {
                for (const row of tableRows) {
                  const cells = row.split('|').filter(c => c.trim() !== '');
                  if (cells.length >= 2) {
                    const title = cells[1].replace(/\*\*/g, '').trim();
                    if (title.length > 5 && !/^-+$/.test(title) && !/criterion/i.test(title)) {
                      tasks.push({ title, done: false });
                    }
                  }
                }
              }
            }
          }
          // Format 4: Sub-sprint table rows — | **26.3.1** | Title | Focus |
          if (!tasks.length) {
            const subSprintRows = content.match(/^\|\s*\*?\*?\d+\.\d+\.\d+\*?\*?\s*\|(.+)\|/gm);
            if (subSprintRows) {
              for (const row of subSprintRows) {
                const cells = row.split('|').filter(c => c.trim() !== '');
                if (cells.length >= 2) {
                  const title = cells[1].replace(/\*\*/g, '').trim();
                  if (title.length > 3 && !/title/i.test(title)) tasks.push({ title, done: false });
                }
              }
            }
          }
          // Format 5: Issue/inventory table — | # | Issue | Severity |
          if (!tasks.length) {
            const issueRows = content.match(/^\|\s*\d+\s*\|([^|]+)\|/gm);
            if (issueRows && issueRows.length >= 2) {
              for (const row of issueRows) {
                const cells = row.split('|').filter(c => c.trim() !== '');
                if (cells.length >= 2) {
                  const title = cells[1].replace(/\*\*/g, '').trim();
                  if (title.length > 5 && !/issue|criterion|what/i.test(title)) {
                    tasks.push({ title, done: false });
                  }
                }
              }
            }
          }
          // Format 6: Epic headings — ## Epic N: Title
          if (!tasks.length) {
            const epicMatch = content.match(/^##\s+Epic\s+\d+[.:]\s*(.+)$/gm);
            if (epicMatch) {
              for (const t of epicMatch) {
                const m = t.match(/^##\s+Epic\s+\d+[.:]\s*(.+)$/);
                if (m) tasks.push({ title: m[1].replace(/\*\*/g, '').trim(), done: false });
              }
            }
          }
          // Format 7: Heading-based sections — ### Step N: Title (fallback)
          if (!tasks.length) {
            const stepMatch = content.match(/^###\s+(?:Step\s+\d+[.:]\s*)?(.+)$/gm);
            if (stepMatch && stepMatch.length >= 2) {
              for (const t of stepMatch) {
                const m = t.match(/^###\s+(?:Step\s+\d+[.:]\s*)?(.+)$/);
                if (m) tasks.push({ title: m[1].replace(/\*\*/g, '').trim(), done: false });
              }
            }
          }

          // Sync with live tasks.jsonl database state
          for (const t of tasks) {
            const key = t.title.trim().toLowerCase();
            if (liveTasksMap.has(key)) {
              const liveStatus = liveTasksMap.get(key);
              t.done = liveStatus === 'complete' || liveStatus === 'done';
            }
          }

          // For completed sprints, mark all ACs as done (sprint specs use [ ] as spec format, not tracking)
          if (sprintStatus === 'complete') {
            for (const t of tasks) t.done = true;
          }
          const tasksDone = tasks.filter(t => t.done).length;

          sprints.push({
            id: file.replace('.md', ''),
            title: titleMatch?.[1]?.replace(/\s*--\s*/, ' — ') ?? file.replace('.md', ''),
            status: sprintStatus,
            file: `docs/product/phases/${phaseDir}/${file}`,
            taskCount: tasks.length,
            tasksDone,
            tasks: tasks.slice(0, 30), // Cap at 30 to avoid huge payloads
          });
        }
      } catch { /* ignore unreadable phase dirs */ }

      // Phase completion: use sprint file statuses, but fall back to README table counts
      // (some phases have more sprints in the README table than individual spec files)
      const fileCompletedSprints = sprints.filter((s: any) => s.status === 'complete').length;
      const totalSprints = Math.max(sprints.length, readmeTotalSprints);
      // If phase-level status is "complete", all sprints are complete — trust the README header
      const completedSprints = phaseStatus === 'complete' ? totalSprints : Math.max(fileCompletedSprints, readmeCompletedSprints);

      phases.push({
        id: phaseDir,
        name: phaseName || `Phase ${phaseNum}`,
        status: phaseStatus,
        sprintCount: totalSprints,
        completedSprints,
        sprints,
      });
    }
  }

  ganttCache = { phases, cachedAt: Date.now() };
  return { phases };
}

// ── Task ID generator ──
let taskCounter = 0;
function nextTaskId(): string {
  taskCounter++;
  return `TASK-${Date.now()}-${taskCounter}`;
}

// ── HTTP Server ──
function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

// Route parameter extraction: /api/scheduled/:name/trigger → { name }
function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── Agent API Routes ──
  if (path === '/api/agents' && method === 'GET') {
    const agents = discoverAgents().map((a, i) => {
      const status = getAgentStatus(a.slug);
      const isRunning = status === 'running';

      let identity_status = 'unverified';
      let runtime = '—';
      let model = '—';

      if (isRunning) {
        // Resolve default runtime dynamically based on agent type
        if (['test', 'code-review', 'backend'].includes(a.slug)) {
          runtime = 'Codex CLI';
        } else if (a.slug === 'api') {
          runtime = 'API';
        } else {
          runtime = 'Claude CLI';
        }

        // Resolve identity_status dynamically from active local session or staging lobby cache
        const isSwarm = DEFAULT_LOBBY_URL && lobbyWsConnected;
        if (isSwarm) {
          const activeRemote = [...stagingAgentRoster.values()].find(s => s.agent_role === a.slug);
          if (activeRemote) {
            identity_status = (activeRemote.identity_status as string) || 'unverified';
            runtime = (activeRemote.runtime as string) || runtime;
            model = (activeRemote.model as string) || '—';
          }
        } else {
          const activeLocal = [...localLobbyAgents.values()].find(s => s.agent_role === a.slug);
          if (activeLocal) {
            identity_status = (activeLocal as any).identity_status || 'unverified';
            runtime = (activeLocal as any).runtime || runtime;
            model = (activeLocal as any).model || '—';
          }
        }
      }

      return {
        ...a,
        status,
        pid: runningAgents[a.slug]?.pid ?? null,
        startedAt: runningAgents[a.slug]?.startedAt ?? null,
        identity_status,
        runtime,
        model,
      };
    });
    sendJson(res, { agents, defaultLobbyUrl: DEFAULT_LOBBY_URL });
    return;
  }

  // ── Loop Mode API Routes (Phase 11) ──
  if (path === '/api/loops' && method === 'GET') {
    sendJson(res, {
      presets: Object.values(LOOP_PRESETS).map(p => ({ name: p.name, description: p.description, unattendedAllowlist: p.unattendedAllowlist })),
      runs: [...loopRuns.values()],
      note: 'Loop runs here are simulated (deterministic seams; no live gate skills/lobby). See docs/loop-mode.md.',
    });
    return;
  }

  if (path === '/api/loops/run' && method === 'POST') {
    const body = await parseBody(req);
    const result = startLoopRun((body.preset as string) || 'continuous-quality', Boolean(body.unattended));
    sendJson(res, result, result.ok ? 200 : 400);
    return;
  }

  if (path === '/api/loops/stop' && method === 'POST') {
    const body = await parseBody(req);
    const run = loopRuns.get(body.id as string);
    if (!run) { sendJson(res, { error: 'unknown loop id' }, 404); return; }
    run.killed = true;
    sendJson(res, { ok: true, id: run.id });
    return;
  }

  if (path === '/api/loops/pause' && method === 'POST') {
    const body = await parseBody(req);
    const runId = body.id as string;
    const run = loopRuns.get(runId);
    if (run) {
      run.paused = true;
      run.status = 'paused';
      broadcastWs('loop-event', { id: runId, type: 'paused', iteration: run.iterations });
      sendJson(res, { ok: true, id: runId });
    } else {
      sendJson(res, { error: 'unknown run' }, 404);
    }
    return;
  }

  if (path === '/api/loops/resume' && method === 'POST') {
    const body = await parseBody(req);
    const runId = body.id as string;
    const run = loopRuns.get(runId);
    if (run) {
      run.paused = false;
      run.status = 'running';
      const resolve = pausedResolvers.get(runId);
      if (resolve) {
        pausedResolvers.delete(runId);
        resolve();
      }
      broadcastWs('loop-event', { id: runId, type: 'resumed', iteration: run.iterations });
      sendJson(res, { ok: true, id: runId });
    } else {
      sendJson(res, { error: 'unknown run' }, 404);
    }
    return;
  }

  if (path === '/api/loops/decide' && method === 'POST') {
    const body = await parseBody(req);
    const runId = body.id as string;
    const approve = Boolean(body.approve);
    const cb = pendingApprovals.get(runId);
    if (cb) {
      pendingApprovals.delete(runId);
      cb(approve);
      sendJson(res, { ok: true, id: runId });
    } else {
      sendJson(res, { error: 'no pending checkpoint for this run' }, 404);
    }
    return;
  }

  if (path === '/api/overview-stats' && method === 'GET') {
    const agents = discoverAgents().map(a => ({
      status: getAgentStatus(a.slug),
    }));
    const onlineAgents = agents.filter(a => a.status === 'running').length;
    const totalAgents = agents.length;

    let tasksInProgress = 0;
    let completed24h = 0;
    let failed24h = 0;
    let blockedTasks = 0;
    let totalCompleted = 0;
    let totalFailed = 0;

    if (existsSync(TASKS_FILE)) {
      try {
        const content = readFileSync(TASKS_FILE, 'utf-8').trim();
        const lines = content.split('\n').filter(l => l.trim());
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        
        for (const line of lines) {
          try {
            const t = JSON.parse(line);
            if (t.status === 'in_progress') {
              tasksInProgress++;
            } else if (t.status === 'blocked') {
              blockedTasks++;
            } else if (t.status === 'done' || t.status === 'complete' || t.status === 'completed') {
              totalCompleted++;
              const ts = t.updated_at ? new Date(t.updated_at).getTime() : Date.now();
              if (ts > oneDayAgo) completed24h++;
            } else if (t.status === 'failed') {
              totalFailed++;
              const ts = t.updated_at ? new Date(t.updated_at).getTime() : Date.now();
              if (ts > oneDayAgo) failed24h++;
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    const gantt = getGanttData();
    let completedSprints = 0;
    let totalSprints = 0;
    for (const p of gantt.phases) {
      completedSprints += (p as any).completedSprints || 0;
      totalSprints += (p as any).sprintCount || 0;
    }
    const sprintProgress = totalSprints > 0 ? Math.round((completedSprints / totalSprints) * 100) : 0;

    const totalRuns = totalCompleted + totalFailed;
    const successPercent = totalRuns > 0 ? Math.round((totalCompleted / totalRuns) * 100) : 100;

    sendJson(res, {
      agents: {
        online: onlineAgents,
        total: totalAgents
      },
      tasks: {
        in_progress: tasksInProgress,
        completed_24h: completed24h,
        failed_24h: failed24h,
        blocked: blockedTasks
      },
      sprint: {
        active: totalSprints > 0,
        progress_percent: sprintProgress,
        completed: completedSprints,
        total: totalSprints
      },
      throughput: {
        tasks_per_day: completed24h,
        window: "24h"
      },
      success_rate: {
        percent: successPercent,
        window: "all-time"
      }
    });
    return;
  }

  if (path === '/api/agents/status' && method === 'GET') {
    const agents = discoverAgents().map((a, i) => {
      const status = getAgentStatus(a.slug);
      const isRunning = status === 'running';

      let identity_status = 'unverified';
      let runtime = '—';
      let model = '—';

      if (isRunning) {
        if (['test', 'code-review', 'backend'].includes(a.slug)) {
          runtime = 'Codex CLI';
        } else if (a.slug === 'api') {
          runtime = 'API';
        } else {
          runtime = 'Claude CLI';
        }

        const isSwarm = DEFAULT_LOBBY_URL && lobbyWsConnected;
        if (isSwarm) {
          const activeRemote = [...stagingAgentRoster.values()].find(s => s.agent_role === a.slug);
          if (activeRemote) {
            identity_status = (activeRemote.identity_status as string) || 'unverified';
            runtime = (activeRemote.runtime as string) || runtime;
            model = (activeRemote.model as string) || '—';
          }
        } else {
          const activeLocal = [...localLobbyAgents.values()].find(s => s.agent_role === a.slug);
          if (activeLocal) {
            identity_status = (activeLocal as any).identity_status || 'unverified';
            runtime = (activeLocal as any).runtime || runtime;
            model = (activeLocal as any).model || '—';
          }
        }
      }

      return {
        slug: a.slug,
        name: a.name,
        status,
        pid: runningAgents[a.slug]?.pid ?? null,
        identity_status,
        runtime,
        model,
      };
    });
    const running = agents.filter(a => a.status === 'running').length;
    sendJson(res, { agents, running, total: agents.length });
    return;
  }

  if (path === '/api/agents/start' && method === 'POST') {
    const body = await parseBody(req);
    const slug = body.slug as string;
    const lobbyUrl = (body.lobbyUrl as string) || DEFAULT_LOBBY_URL;
    if (!slug) { sendJson(res, { error: 'slug required' }, 400); return; }
    const result = startAgent(slug, lobbyUrl);
    sendJson(res, result, result.ok ? 200 : 400);
    return;
  }

  if (path === '/api/agents/stop' && method === 'POST') {
    const body = await parseBody(req);
    const slug = body.slug as string;
    if (!slug) { sendJson(res, { error: 'slug required' }, 400); return; }
    const result = stopAgent(slug);
    sendJson(res, result, result.ok ? 200 : 400);
    return;
  }

  if (path === '/api/agents/start-all' && method === 'POST') {
    const body = await parseBody(req);
    const slugs = body.slugs as string[];
    const lobbyUrl = (body.lobbyUrl as string) || DEFAULT_LOBBY_URL;
    if (!Array.isArray(slugs)) { sendJson(res, { error: 'slugs array required' }, 400); return; }
    const results: Record<string, { ok: boolean; error?: string }> = {};
    for (const slug of slugs.slice(0, 10)) {
      results[slug] = startAgent(slug, lobbyUrl);
      await new Promise(r => setTimeout(r, 100));
    }
    sendJson(res, { results });
    return;
  }

  if (path === '/api/agents/stop-all' && method === 'POST') {
    const results: Record<string, { ok: boolean; error?: string }> = {};
    for (const slug of [...runningProcesses.keys()]) {
      results[slug] = stopAgent(slug);
    }
    sendJson(res, { results });
    return;
  }

  if (path === '/api/agents/logs' && method === 'GET') {
    const slug = url.searchParams.get('slug');
    if (!slug) { sendJson(res, { error: 'slug required' }, 400); return; }
    const logFile = join(LOGS_DIR, `${slug}.log`);
    if (existsSync(logFile)) {
      const content = readFileSync(logFile, 'utf-8');
      const lines = content.split('\n').slice(-100);
      sendJson(res, { slug, lines });
    } else {
      sendJson(res, { slug, lines: [] });
    }
    return;
  }

  // ── Scheduled Task API ──
  if (path === '/api/scheduled' && method === 'GET') {
    const config = getScheduledConfig() as { schedules?: Record<string, unknown> };
    const schedules = config.schedules ?? {};
    const tasks = Object.entries(schedules).map(([name, cfg]) => {
      const state = getScheduledTaskState(name);
      const running = scheduledProcesses.has(name);
      return {
        name,
        config: cfg,
        state,
        running,
        pid: scheduledState[name]?.pid ?? null,
        startedAt: scheduledState[name]?.startedAt ?? null,
      };
    });
    sendJson(res, { tasks });
    return;
  }

  {
    const params = matchRoute('/api/scheduled/:name/trigger', path);
    if (params && method === 'POST') {
      const result = triggerScheduledTask(params.name);
      sendJson(res, result, result.ok ? 200 : 400);
      return;
    }
  }

  {
    const params = matchRoute('/api/scheduled/:name/toggle', path);
    if (params && method === 'POST') {
      try {
        const config = getScheduledConfig() as { schedules?: Record<string, { enabled?: boolean }> };
        const task = config.schedules?.[params.name];
        if (!task) { sendJson(res, { error: 'Unknown task' }, 404); return; }
        task.enabled = !task.enabled;
        writeFileSync(SCHEDULED_CONFIG, JSON.stringify(config, null, 2));
        sendJson(res, { ok: true, enabled: task.enabled });
      } catch (err) {
        sendJson(res, { error: String(err) }, 500);
      }
      return;
    }
  }

  {
    const params = matchRoute('/api/scheduled/:name/schedule', path);
    if (params && method === 'POST') {
      const body = await parseBody(req);
      const timeUtc = body.time_utc as string;
      if (!timeUtc) { sendJson(res, { error: 'time_utc required' }, 400); return; }
      try {
        const config = getScheduledConfig() as { schedules?: Record<string, { time_utc?: string }> };
        const task = config.schedules?.[params.name];
        if (!task) { sendJson(res, { error: 'Unknown task' }, 404); return; }
        task.time_utc = timeUtc;
        writeFileSync(SCHEDULED_CONFIG, JSON.stringify(config, null, 2));
        sendJson(res, { ok: true, time_utc: timeUtc });
      } catch (err) {
        sendJson(res, { error: String(err) }, 500);
      }
      return;
    }
  }

  {
    const params = matchRoute('/api/scheduled/:name/logs', path);
    if (params && method === 'GET') {
      const logFile = join(LOGS_DIR, `scheduled-${params.name}.log`);
      const state = getScheduledTaskState(params.name);
      const lines = existsSync(logFile) ? readFileSync(logFile, 'utf-8').split('\n').slice(-100) : [];
      sendJson(res, { name: params.name, state, lines });
      return;
    }
  }

  // ── Prompt Editor API ──
  {
    const params = matchRoute('/api/scheduled/:name/prompt', path);
    if (params && method === 'GET') {
      const config = getScheduledConfig() as { schedules?: Record<string, { prompt?: string }> };
      const taskConfig = config.schedules?.[params.name];
      if (!taskConfig) { sendJson(res, { error: 'Unknown task' }, 404); return; }
      const promptPath = join(SCHEDULED_DIR, taskConfig.prompt ?? `prompts/${params.name}.md`);
      // Security: must stay within agent-os/scheduled/prompts/
      const promptsDir = join(SCHEDULED_DIR, 'prompts');
      if (!promptPath.startsWith(promptsDir)) { sendJson(res, { error: 'Path outside prompts directory' }, 403); return; }
      if (!existsSync(promptPath)) { sendJson(res, { error: 'Prompt file not found' }, 404); return; }
      const content = readFileSync(promptPath, 'utf-8');
      sendJson(res, { name: params.name, path: taskConfig.prompt, content });
      return;
    }
    if (params && method === 'PUT') {
      const body = await parseBody(req);
      const content = body.content as string;
      if (typeof content !== 'string') { sendJson(res, { error: 'content required' }, 400); return; }
      const config = getScheduledConfig() as { schedules?: Record<string, { prompt?: string }> };
      const taskConfig = config.schedules?.[params.name];
      if (!taskConfig) { sendJson(res, { error: 'Unknown task' }, 404); return; }
      const promptPath = join(SCHEDULED_DIR, taskConfig.prompt ?? `prompts/${params.name}.md`);
      const promptsDir = join(SCHEDULED_DIR, 'prompts');
      if (!promptPath.startsWith(promptsDir)) { sendJson(res, { error: 'Path outside prompts directory' }, 403); return; }
      try {
        writeFileSync(promptPath, content, 'utf-8');
        sendJson(res, { ok: true, name: params.name });
      } catch (err) {
        sendJson(res, { error: String(err) }, 500);
      }
      return;
    }
  }

  // ── File Browser API ──
  if (path === '/api/files' && (method === 'GET' || method === 'PUT')) {
    const requestedPath = url.searchParams.get('path') ?? '';
    // Security: reject paths with .. and ensure resolved path stays within repo root
    if (requestedPath.includes('..')) { sendJson(res, { error: 'Path traversal blocked' }, 403); return; }
    const fullPath = resolve(REPO_ROOT, requestedPath);
    if (!fullPath.startsWith(REPO_ROOT)) { sendJson(res, { error: 'Path outside repo' }, 403); return; }
    // Block sensitive directories
    const BLOCKED_DIRS = ['.git', 'node_modules', '.env'];
    const relParts = requestedPath.split('/');
    if (relParts.some(p => BLOCKED_DIRS.includes(p))) { sendJson(res, { error: 'Access denied' }, 403); return; }

    if (method === 'GET') {
      if (!existsSync(fullPath)) { sendJson(res, { error: 'Not found' }, 404); return; }
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        const HIDDEN_ENTRIES = ['.', '..', '.git', 'node_modules', '.env', '.husky', '.github', '.claude'];
        const entries = readdirSync(fullPath)
          .filter(name => !HIDDEN_ENTRIES.includes(name))
          .map(name => {
            try {
              const entryPath = join(fullPath, name);
              const entryStat = statSync(entryPath);
              return {
                name,
                type: entryStat.isDirectory() ? 'directory' : 'file',
                size: entryStat.isFile() ? entryStat.size : undefined,
              };
            } catch {
              return null; // skip entries that can't be stat'd
            }
          })
          .filter((e): e is NonNullable<typeof e> => e !== null);
        // Sort: directories first, then alphabetical
        entries.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        sendJson(res, { type: 'directory', path: requestedPath, entries });
      } else {
        // Limit file reads to 1MB
        if (stat.size > 1_048_576) { sendJson(res, { error: 'File too large (>1MB)' }, 413); return; }
        const content = readFileSync(fullPath, 'utf-8');
        sendJson(res, { type: 'file', path: requestedPath, content, size: stat.size });
      }
      return;
    }

    if (method === 'PUT') {
      const body = await parseBody(req);
      const content = body.content as string;
      if (typeof content !== 'string') { sendJson(res, { error: 'content required' }, 400); return; }
      try {
        writeFileSync(fullPath, content, 'utf-8');
        sendJson(res, { ok: true, path: requestedPath });
      } catch (err) {
        sendJson(res, { error: String(err) }, 500);
      }
      return;
    }
  }

  // ── Lobby API ──
  if (path === '/api/lobby/state' && method === 'GET') {
    let lobbyState = { bossAgentSlug: null, phase: 'idle', handRaises: [] as unknown[], floorHolder: null };
    if (existsSync(LOBBY_STATE_FILE)) {
      try { lobbyState = JSON.parse(readFileSync(LOBBY_STATE_FILE, 'utf-8')); } catch { /* ignore */ }
    }
    const agents = discoverAgents().map(a => ({
      ...a,
      status: getAgentStatus(a.slug),
      pid: runningAgents[a.slug]?.pid ?? null,
      startedAt: runningAgents[a.slug]?.startedAt ?? null,
    }));
    sendJson(res, { lobby: lobbyState, agents });
    return;
  }

  if (path === '/api/lobby/state' && method === 'POST') {
    const body = await parseBody(req);
    writeFileSync(LOBBY_STATE_FILE, JSON.stringify(body, null, 2));
    broadcastWs('lobby-update', body);
    sendJson(res, { ok: true });
    return;
  }

  // ── Remote Lobby Roster (shows ALL agents from ALL panels connected to the same lobby) ──
  if (path === '/api/lobby/roster' && method === 'GET') {
    const lobbyUrl = url.searchParams.get('lobby') || DEFAULT_LOBBY_URL;
    const roster = await fetchRemoteLobbyRoster(lobbyUrl);
    // Merge with local agent info
    const localAgents = discoverAgents().map(a => ({
      ...a,
      status: getAgentStatus(a.slug),
      pid: runningAgents[a.slug]?.pid ?? null,
      startedAt: runningAgents[a.slug]?.startedAt ?? null,
      panelId: PANEL_ID,
      source: 'local',
    }));
    sendJson(res, {
      ...(roster as Record<string, unknown>),
      localAgents,
      panelId: PANEL_ID,
    });
    return;
  }

  // ── Staging API Proxy (Sessions, Lobby remote data) ──
  if (path === '/api/sessions' && method === 'GET') {
    const data = await proxyToStaging(DEFAULT_LOBBY_URL, '/api/v1/ui-assist/sessions');
    sendJson(res, data);
    return;
  }

  {
    const params = matchRoute('/api/sessions/:id', path);
    if (params && method === 'GET') {
      const data = await proxyToStaging(DEFAULT_LOBBY_URL, `/api/v1/ui-assist/sessions/${params.id}`);
      sendJson(res, data);
      return;
    }
  }

  if (path === '/api/lobby/remote/agents' && method === 'GET') {
    const lobbyId = await resolveLobbyId();
    if (!lobbyId && stagingAgentRoster.size === 0) {
      sendJson(res, { agents: [], error: 'No active lobby' }); return;
    }
    // Try REST proxy first
    if (lobbyId) {
      const data = await proxyToStaging(DEFAULT_LOBBY_URL, `/api/v1/agent-lobby/lobbies/${lobbyId}/roster`);
      const agents = (data as any)?.agents;
      if (agents?.length) {
        // Update cache from REST response
        for (const a of agents) {
          if (a.agent_id) {
            if (a.display_name) stagingAgentNames.set(a.agent_id, a.display_name);
            stagingAgentRoster.set(a.agent_id, a);
          }
        }
        sendJson(res, data);
        return;
      }
    }
    // Fall back to WS-cached roster (works even when REST proxy requires auth)
    if (stagingAgentRoster.size > 0) {
      sendJson(res, { agents: [...stagingAgentRoster.values()], source: 'ws-cache' });
      return;
    }
    sendJson(res, { agents: [], error: 'No agents available' });
    return;
  }

  if (path === '/api/lobby/remote/messages' && method === 'GET') {
    const lobbyId = await resolveLobbyId();
    if (!lobbyId) { sendJson(res, { messages: [], error: 'No active lobby' }); return; }
    const limit = url.searchParams.get('limit') || '100';
    const data = await proxyToStaging(DEFAULT_LOBBY_URL, `/api/v1/agent-lobby/lobbies/${lobbyId}/messages?limit=${limit}`);
    sendJson(res, data);
    return;
  }

  if (path === '/api/lobby/remote/tasks' && method === 'GET') {
    const lobbyId = await resolveLobbyId();
    if (!lobbyId) { sendJson(res, { tasks: [], error: 'No active lobby' }); return; }
    const data = await proxyToStaging(DEFAULT_LOBBY_URL, `/api/v1/agent-lobby/lobbies/${lobbyId}/tasks`);
    sendJson(res, data);
    return;
  }

  if (path === '/api/lobby/remote/requests' && method === 'GET') {
    const lobbyId = await resolveLobbyId();
    if (!lobbyId) { sendJson(res, { requests: [], error: 'No active lobby' }); return; }
    const data = await proxyToStaging(DEFAULT_LOBBY_URL, `/api/v1/agent-lobby/lobbies/${lobbyId}/requests/pending`);
    sendJson(res, data);
    return;
  }

  {
    const params = matchRoute('/api/lobby/remote/requests/:id/decide', path);
    if (params && method === 'POST') {
      const body = await parseBody(req);
      const lobbyId = await resolveLobbyId();
      if (!lobbyId) { sendJson(res, { error: 'No active lobby' }, 400); return; }
      const data = await proxyToStaging(DEFAULT_LOBBY_URL,
        `/api/v1/agent-lobby/lobbies/${lobbyId}/requests/${params.id}/decide`,
        'POST', JSON.stringify(body));
      sendJson(res, data);
      return;
    }
  }

  if (path === '/api/lobby/remote/boss-agent' && method === 'POST') {
    const body = await parseBody(req);
    const agentId = body.agent_id as string;
    if (!agentId) { sendJson(res, { error: 'agent_id required' }, 400); return; }

    // Try REST proxy first (requires auth)
    const lobbyId = await resolveLobbyId();
    if (lobbyId) {
      const data = await proxyToStaging(DEFAULT_LOBBY_URL,
        `/api/v1/agent-lobby/lobbies/${lobbyId}/boss-agent`,
        'POST', JSON.stringify(body));
      if (!(data as any)?.error) {
        // Update local state immediately
        lobbyBossAgentId = agentId;
        try {
          const stateFile = existsSync(LOBBY_STATE_FILE) ? JSON.parse(readFileSync(LOBBY_STATE_FILE, 'utf-8')) : {};
          stateFile.bossAgentSlug = agentId;
          writeFileSync(LOBBY_STATE_FILE, JSON.stringify(stateFile, null, 2));
        } catch { /* ignore */ }
        broadcastWs('lobby-boss-update', { agent_id: agentId, type: 'appointed' });
        sendJson(res, data);
        return;
      }
    }

    // REST failed (no auth) — try WS channel instead
    if (lobbyClient && lobbyWsConnected) {
      lobbyClient.send({ type: 'lobby-boss-appoint', agent_id: agentId });
      console.log(`Lobby: boss appointment sent via WS (REST proxy requires auth)`);
    }
    // Update local state immediately (WS broadcast from coordinator will confirm)
    lobbyBossAgentId = agentId;
    try {
      const stateFile = existsSync(LOBBY_STATE_FILE) ? JSON.parse(readFileSync(LOBBY_STATE_FILE, 'utf-8')) : {};
      stateFile.bossAgentSlug = agentId;
      writeFileSync(LOBBY_STATE_FILE, JSON.stringify(stateFile, null, 2));
    } catch { /* ignore */ }
    broadcastWs('lobby-boss-update', { agent_id: agentId, type: 'appointed' });
    sendJson(res, { ok: true, agent_id: agentId });
    return;
  }

  // ── Role Change API (Panel → staging via WS) ──
  if (path === '/api/lobby/remote/role-change' && method === 'POST') {
    const body = await parseBody(req);
    const targetId = body.agent_id as string;
    const newRole = body.agent_role as string;
    if (!targetId || !newRole) { sendJson(res, { error: 'agent_id and agent_role required' }, 400); return; }

    if (lobbyClient && lobbyWsConnected) {
      lobbyClient.send({ type: 'lobby-role-change', agent_id: targetId, agent_role: newRole as any });
      console.log(`Lobby: role change sent via WS — ${targetId} → ${newRole}`);
    } else {
      // Local mode fallback
      const agent = localLobbyAgents.get(targetId);
      if (agent) {
        agent.agent_role = newRole;
        broadcastWs('lobby-agent-update', { type: 'lobby-agent-updated', agent });
      }
    }
    sendJson(res, { ok: true, agent_id: targetId, agent_role: newRole });
    return;
  }

  if (path === '/api/lobby/remote/status' && method === 'PATCH') {
    const body = await parseBody(req);
    const lobbyId = await resolveLobbyId();
    if (!lobbyId) { sendJson(res, { error: 'No active lobby' }, 400); return; }
    const data = await proxyToStaging(DEFAULT_LOBBY_URL,
      `/api/v1/agent-lobby/lobbies/${lobbyId}/status`,
      'PATCH', JSON.stringify(body));
    cachedLobbyId = null; // Invalidate cache on status change
    sendJson(res, data);
    return;
  }

  if (path === '/api/lobby/remote/create' && method === 'POST') {
    const body = await parseBody(req);
    const result = await postRemoteJson(DEFAULT_LOBBY_URL, '/api/v1/agent-lobby/lobbies', body);
    sendJson(res, result);
    return;
  }

  if (path === '/api/lobby/remote/join' && method === 'POST') {
    const body = await parseBody(req);
    const newLobbyId = body.lobby_id as string || null;
    activeLobbyId = newLobbyId;
    console.log(`Lobby WS: switching active lobby to ${activeLobbyId || 'default (discovered)'}`);
    stagingAgentRoster.clear();
    stagingAgentNames.clear();
    if (lobbyClient) {
      lobbyWsConnected = false;
      lobbyClient.close();
      lobbyClient = null;
    }
    connectLobbyWs();
    sendJson(res, { ok: true, lobby_id: activeLobbyId });
    return;
  }

  // ── Messages API — staging-first with local fallback ──
  if (path === '/api/messages' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') ?? '50');

    // Build agent ID → display name lookup from cached roster + local agents
    const lobbyId = await resolveLobbyId();
    const agentNameMap = new Map<string, string>(stagingAgentNames); // WS-cached staging names
    for (const [id, agent] of localLobbyAgents) {
      agentNameMap.set(id, agent.display_name);
    }
    function enrichMessage(m: Record<string, unknown>): Record<string, unknown> {
      const fromId = String(m.from_agent_id || '');
      const toId = String(m.to_agent_id || '');
      if (fromId && !m.from_display_name && agentNameMap.has(fromId)) {
        m.from_display_name = agentNameMap.get(fromId);
      }
      if (toId && toId !== 'all' && !m.to_display_name && agentNameMap.has(toId)) {
        m.to_display_name = agentNameMap.get(toId);
      }
      return m;
    }

    // Try staging lobby messages first
    if (lobbyId) {
      const staging = await proxyToStaging(DEFAULT_LOBBY_URL,
        `/api/v1/agent-lobby/lobbies/${lobbyId}/messages?limit=${limit}`);
      const stagingMsgs = ((staging as any)?.messages || (Array.isArray(staging) ? staging : [])).map((m: any) => enrichMessage(m));
      if (stagingMsgs.length) {
        // Merge with local messages for completeness
        const localMsgs = readJsonlTail(BUS_FILE, 20).map(l => { try { return enrichMessage(JSON.parse(l)); } catch { return null; } }).filter(Boolean);
        const merged = [...stagingMsgs, ...localMsgs]
          .sort((a: any, b: any) => (a.created_at || a.timestamp || '').localeCompare(b.created_at || b.timestamp || ''))
          .slice(-limit);
        sendJson(res, { messages: merged, source: 'staging' });
        return;
      }
    }

    // Fallback to local bus.jsonl
    const agent = url.searchParams.get('agent') ?? '';
    const type = url.searchParams.get('type') ?? '';
    if (agent || type) {
      const filters: Record<string, string> = {};
      if (agent) filters.from = agent;
      if (type) filters.type = type;
      sendJson(res, { messages: readJsonlFiltered(BUS_FILE, filters, limit), source: 'local' });
    } else {
      const messages = readJsonlTail(BUS_FILE, limit);
      sendJson(res, { messages: messages.map(l => { try { return JSON.parse(l); } catch { return l; } }), source: 'local' });
    }
    return;
  }

  if (path === '/api/messages/clear' && method === 'POST') {
    try { writeFileSync(BUS_FILE, ''); } catch { /* ignore */ }
    broadcastWs('messages', {});
    sendJson(res, { ok: true });
    return;
  }

  if (path === '/api/messages' && method === 'POST') {
    const body = await parseBody(req);
    const msg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      from: body.from ?? 'panel',
      to: body.to ?? '*',
      type: body.type ?? 'finding',
      content: body.content ?? '',
    };

    // Send to staging lobby via WebSocket bridge (REST POST requires auth)
    const toAgent = body.to === '*' ? 'all' : String(body.to ?? 'all');
    const sentToStaging = sendLobbyMessage(String(body.content ?? ''), toAgent, body.message_type ?? 'chat');

    // Always write to local bus.jsonl as mirror
    appendFileSync(BUS_FILE, JSON.stringify(msg) + '\n');
    broadcastWs('message', msg);
    sendJson(res, { ok: true, message: msg, sentToStaging });
    return;
  }

  // ── Identity API ──
  const IDENTITY_CARD_FILE = join(REPO_ROOT, 'agent-card.json');

  if (path === '/api/identity/card' && method === 'GET') {
    try {
      const card = existsSync(IDENTITY_CARD_FILE)
        ? JSON.parse(readFileSync(IDENTITY_CARD_FILE, 'utf-8'))
        : {
            name: '',
            description: '',
            capabilities: [],
            runtime: 'claude-cli',
            ownerPolicy: 'none',
            supportedProtocols: ['lobby-message'],
            allowedScopes: ['*'],
            version: '1.0.0',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
      sendJson(res, { card });
    } catch {
      sendJson(res, { error: 'Failed to read identity card' }, 500);
    }
    return;
  }

  if (path === '/api/identity/card' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const card = body.card;
      card.updatedAt = new Date().toISOString();
      writeFileSync(IDENTITY_CARD_FILE, JSON.stringify(card, null, 2), 'utf-8');
      sendJson(res, { ok: true, card });
    } catch (err: any) {
      sendJson(res, { error: err.message || 'Failed to write identity card' }, 500);
    }
    return;
  }

  if (path === '/api/identity/validate-card' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const card = body.card;
      const validation = validateAgentCard(card);
      if (!validation.ok) {
        sendJson(res, { ok: false, errors: validation.errors });
        return;
      }
      const hash = hashAgentCard(card);
      sendJson(res, { ok: true, hash });
    } catch (err: any) {
      sendJson(res, { ok: false, errors: [err.message] });
    }
    return;
  }

  if (path === '/api/identity/prepare-registration' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const card = body.card;
      const network = body.network || 'testnet';
      const plan = prepareRegistration(card, { network });
      sendJson(res, { ok: true, plan });
    } catch (err: any) {
      sendJson(res, { error: err.message || 'Failed to prepare registration' }, 500);
    }
    return;
  }

  // ── Sessions API (panel-local persistence) ──
  const SESSIONS_FILE = join(SHARED_MEM_DIR, 'state/sessions.json');

  if (path === '/api/sessions' && method === 'GET') {
    try {
      const data = existsSync(SESSIONS_FILE) ? JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8')) : [];
      sendJson(res, { sessions: Array.isArray(data) ? data : [] });
    } catch { sendJson(res, { sessions: [] }); }
    return;
  }

  if (path === '/api/sessions' && method === 'POST') {
    const body = await parseBody(req);
    const session = {
      session_id: body.session_id || `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      element_label: body.element_label || '',
      preview: body.preview || '',
      status: 'active',
      messages: body.messages || [],
      message_count: body.messages?.length || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    try {
      const data = existsSync(SESSIONS_FILE) ? JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8')) : [];
      const sessions = Array.isArray(data) ? data : [];
      sessions.unshift(session);
      // Cap at 50 sessions
      if (sessions.length > 50) sessions.length = 50;
      writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    } catch { writeFileSync(SESSIONS_FILE, JSON.stringify([session], null, 2)); }
    sendJson(res, session);
    return;
  }

  {
    const sessionParams = matchRoute('/api/sessions/:id', path);
    if (sessionParams && method === 'GET') {
      try {
        const data = existsSync(SESSIONS_FILE) ? JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8')) : [];
        const session = (Array.isArray(data) ? data : []).find((s: Record<string, unknown>) => s.session_id === sessionParams.id);
        if (session) { sendJson(res, session); } else { sendJson(res, { error: 'Not found' }, 404); }
      } catch { sendJson(res, { error: 'Not found' }, 404); }
      return;
    }
    if (sessionParams && method === 'PATCH') {
      const body = await parseBody(req);
      try {
        const data = existsSync(SESSIONS_FILE) ? JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8')) : [];
        const sessions = Array.isArray(data) ? data : [];
        const session = sessions.find((s: Record<string, unknown>) => s.session_id === sessionParams.id);
        if (session) {
          if (body.messages) { session.messages = body.messages; session.message_count = body.messages?.length || 0; }
          if (body.status) session.status = body.status;
          if (body.preview) session.preview = body.preview;
          session.updated_at = new Date().toISOString();
          writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
          sendJson(res, session);
        } else { sendJson(res, { error: 'Not found' }, 404); }
      } catch { sendJson(res, { error: 'Failed' }, 500); }
      return;
    }
  }

  // ── Observations API ──
  if (path === '/api/observations' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') ?? '20');
    const observations = readJsonlTail(OBS_FILE, limit);
    sendJson(res, { observations: observations.map(l => { try { return JSON.parse(l); } catch { return l; } }) });
    return;
  }

  // ── Tasks API — staging-first with local fallback ──
  if (path === '/api/tasks' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') ?? '100');

    // Try staging lobby tasks first
    const lobbyId = await resolveLobbyId();
    if (lobbyId) {
      const staging = await proxyToStaging(DEFAULT_LOBBY_URL,
        `/api/v1/agent-lobby/lobbies/${lobbyId}/tasks`);
      const stagingTasks = (staging as any)?.tasks || (Array.isArray(staging) ? staging : []);
      if (stagingTasks.length) {
        // Merge with local tasks
        const localTasks = readJsonlTail(TASKS_FILE, 50)
          .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        const allTasks = [...stagingTasks, ...localTasks].slice(-limit);
        sendJson(res, { tasks: allTasks, source: 'staging' });
        return;
      }
    }

    // Fallback to local tasks.jsonl
    const status = url.searchParams.get('status') ?? '';
    if (status) {
      sendJson(res, { tasks: readJsonlFiltered(TASKS_FILE, { status }, limit), source: 'local' });
    } else {
      const tasks = readJsonlTail(TASKS_FILE, limit);
      sendJson(res, { tasks: tasks.map(l => { try { return JSON.parse(l); } catch { return l; } }), source: 'local' });
    }
    return;
  }

  if (path === '/api/tasks' && method === 'POST') {
    const body = await parseBody(req);
    const task = {
      task_id: nextTaskId(),
      title: body.title ?? 'Untitled',
      description: body.description ?? '',
      status: body.status ?? 'pending',
      priority: body.priority ?? 'normal',
      assigned_to: body.assigned_to ?? '',
      category: body.category ?? 'general',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      dependencies: body.dependencies ?? [],
    };

    // Send to staging lobby if agent is assigned and lobby active
    let sentToStaging = false;
    if (task.assigned_to) {
      const lobbyId = await resolveLobbyId();
      if (lobbyId) {
        const result = await proxyToStaging(DEFAULT_LOBBY_URL,
          `/api/v1/agent-lobby/lobbies/${lobbyId}/tasks`,
          'POST', JSON.stringify({
            title: task.title,
            description: task.description,
            assigned_to: task.assigned_to,
            priority: task.priority,
            category: task.category,
          }));
        sentToStaging = !(result as any)?.error;
      }
    }

    // Always write to local tasks.jsonl as mirror
    appendFileSync(TASKS_FILE, JSON.stringify(task) + '\n');
    broadcastWs('task-created', task);
    sendJson(res, { ok: true, task, sentToStaging });
    return;
  }

  {
    const params = matchRoute('/api/tasks/:id', path);
    if (params && method === 'PATCH') {
      const body = await parseBody(req);
      // Read all tasks, find by ID, update, rewrite
      if (!existsSync(TASKS_FILE)) { sendJson(res, { error: 'No tasks file' }, 404); return; }
      const lines = readFileSync(TASKS_FILE, 'utf-8').trim().split('\n').filter(l => l.trim());
      let found = false;
      let updatedTask: unknown = null;
      const newLines = lines.map(line => {
        try {
          const task = JSON.parse(line) as Record<string, unknown>;
          if (task.task_id === params.id) {
            found = true;
            const updated = { ...task, ...body, task_id: params.id, updated_at: new Date().toISOString() };
            updatedTask = updated;
            return JSON.stringify(updated);
          }
        } catch { /* skip */ }
        return line;
      });
      if (!found) { sendJson(res, { error: 'Task not found' }, 404); return; }
      writeFileSync(TASKS_FILE, newLines.join('\n') + '\n');
      broadcastWs('task-updated', updatedTask);
      sendJson(res, { ok: true, task: updatedTask });
      return;
    }
  }

  {
    const params = matchRoute('/api/tasks/:id/delete', path);
    if (params && method === 'POST') {
      if (!existsSync(TASKS_FILE)) { sendJson(res, { error: 'No tasks file' }, 404); return; }
      const lines = readFileSync(TASKS_FILE, 'utf-8').trim().split('\n').filter(l => l.trim());
      const newLines = lines.filter(line => {
        try {
          const task = JSON.parse(line) as Record<string, unknown>;
          return task.task_id !== params.id;
        } catch { return true; }
      });
      writeFileSync(TASKS_FILE, newLines.join('\n') + '\n');
      broadcastWs('task-updated', { task_id: params.id, deleted: true });
      sendJson(res, { ok: true });
      return;
    }
  }

  // ── Mode API ──
  if (path === '/api/mode' && method === 'GET') {
    const isSwarm = !!activeLobbyUrl;
    sendJson(res, {
      mode: isSwarm ? 'swarm' : 'local',
      lobbyUrl: activeLobbyUrl || `http://localhost:${PORT}`,
      localLobbyAgents: isSwarm ? undefined : localLobbyAgents.size,
      localLobbyBoss: isSwarm ? undefined : localLobbyBossId,
    });
    return;
  }

  // ── Local Lobby Discover (mirrors staging's /api/v1/agent-lobby/discover) ──
  if (path === '/api/v1/agent-lobby/discover' && method === 'GET') {
    sendJson(res, {
      lobby: {
        lobby_id: `local-${PANEL_ID}`,
        org_id: 'local',
        name: 'Local Agent Lobby',
        status: 'active',
        boss_agent_id: localLobbyBossId,
      },
    });
    return;
  }

  // ── Local Lobby Messages (mirrors staging's messages endpoint) ──
  if (path.match(/^\/api\/v1\/agent-lobby\/lobbies\/[^/]+\/messages$/) && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') ?? '50');
    sendJson(res, { messages: localLobbyMessages.slice(-limit) });
    return;
  }

  // ── Local Lobby Tasks (mirrors staging's tasks endpoint) ──
  if (path.match(/^\/api\/v1\/agent-lobby\/lobbies\/[^/]+\/tasks$/) && method === 'GET') {
    sendJson(res, { tasks: localLobbyTasks });
    return;
  }

  if (path.match(/^\/api\/v1\/agent-lobby\/lobbies\/[^/]+\/tasks$/) && method === 'POST') {
    const body = await parseBody(req);
    const task = {
      task_id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: body.title || 'Untitled',
      description: body.description || '',
      assigned_to: body.assigned_to || '',
      priority: body.priority || 'normal',
      category: body.category || 'general',
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    localLobbyTasks.push(task);
    // Notify the assigned agent via local lobby WS
    const conn = localLobbyAgentConns.get(task.assigned_to);
    if (conn && conn.readyState === WebSocket.OPEN) {
      conn.send(JSON.stringify({ type: 'lobby-task-assigned', task }));
    }
    broadcastWs('lobby-task-update', { type: 'lobby-task-assigned', task });
    sendJson(res, task);
    return;
  }

  // ── Local Lobby Boss Appointment ──
  if (path.match(/^\/api\/v1\/agent-lobby\/lobbies\/[^/]+\/boss-agent$/) && method === 'POST') {
    const body = await parseBody(req);
    const agentId = body.agent_id as string;
    if (!agentId) { sendJson(res, { error: 'agent_id required' }, 400); return; }
    localLobbyBossId = agentId;
    // Broadcast to all local lobby agents
    for (const [, ws] of localLobbyAgentConns) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'lobby-boss-appointed', agent_id: agentId }));
      }
    }
    // Update local state + panel clients
    lobbyBossAgentId = agentId;
    try {
      const stateFile = existsSync(LOBBY_STATE_FILE) ? JSON.parse(readFileSync(LOBBY_STATE_FILE, 'utf-8')) : {};
      stateFile.bossAgentSlug = agentId;
      writeFileSync(LOBBY_STATE_FILE, JSON.stringify(stateFile, null, 2));
    } catch { /* ignore */ }
    broadcastWs('lobby-boss-update', { agent_id: agentId, type: 'appointed' });
    // System message
    const agent = [...localLobbyAgents.values()].find(a => a.agent_id === agentId);
    const sysMsg = { message_id: `msg-${Date.now()}`, from_agent_id: 'system', to_agent_id: 'all', message_type: 'system', content: `**${agent?.display_name ?? agentId}** was appointed as **Boss Agent**.`, created_at: new Date().toISOString() };
    localLobbyMessages.push(sysMsg);
    broadcastWs('lobby-message', sysMsg);
    sendJson(res, { ok: true, boss_agent_id: agentId });
    return;
  }

  // ── Local Lobby Agents (mirrors staging's agents endpoint) ──
  if (path.match(/^\/api\/v1\/agent-lobby\/lobbies\/[^/]+\/agents$/) && method === 'GET') {
    sendJson(res, { agents: [...localLobbyAgents.values()] });
    return;
  }

  // ── Local Lobby Requests (mirrors staging's requests endpoint) ──
  if (path.match(/^\/api\/v1\/agent-lobby\/lobbies\/[^/]+\/requests\/pending$/) && method === 'GET') {
    const pending = localLobbyRequests.filter(r => r.status === 'pending');
    sendJson(res, { requests: pending });
    return;
  }

  {
    const reqParams = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/[^/]+\/requests\/([^/]+)\/decide$/);
    if (reqParams && method === 'POST') {
      const body = await parseBody(req);
      const reqId = reqParams[1];
      const request = localLobbyRequests.find(r => r.request_id === reqId);
      if (!request) { sendJson(res, { error: 'Request not found' }, 404); return; }
      request.status = body.decision || 'approved';
      request.decided_by = body.decided_by || 'panel';
      request.decision_notes = body.decision_notes || '';
      request.decided_at = new Date().toISOString();
      // Notify the requesting agent
      const conn = localLobbyAgentConns.get(request.agent_id as string);
      if (conn && conn.readyState === WebSocket.OPEN) {
        conn.send(JSON.stringify({ type: 'lobby-request-decided', request }));
      }
      broadcastWs('lobby-request-decided', request);
      sendJson(res, { ok: true, request });
      return;
    }
  }

  // ── Gantt API ──
  if (path === '/api/gantt/phases' && method === 'GET') {
    sendJson(res, getGanttData());
    return;
  }

  // ── Relay Status ──
  if (path === '/api/relay' && method === 'GET') {
    sendJson(res, { status: relayStatus, port: RELAY_PORT, pid: relayProcess?.pid ?? null });
    return;
  }

  if (path === '/api/relay/restart' && method === 'POST') {
    stopRelay();
    setTimeout(() => startRelay(), 500);
    sendJson(res, { ok: true });
    return;
  }

  // ── Runtime Adapters ──
  // Discover which agent runtimes are installed via the adapter registry
  // (@agent-os/adapters). The panel uses this to show available runtimes and
  // pick a default; today Claude CLI is the first-class runtime.
  if (path === '/api/runtimes' && method === 'GET') {
    runtimeRegistry
      .detectAll()
      .then((runtimes) => {
        const available = Object.entries(runtimes)
          .filter(([, r]) => r.installed)
          .map(([id]) => id);
        sendJson(res, {
          runtimes,
          available,
          default: available.includes('claude-cli') ? 'claude-cli' : (available[0] ?? null),
        });
      })
      .catch((err: unknown) => {
        sendJson(res, { error: (err as Error).message, runtimes: {}, available: [], default: null }, 500);
      });
    return;
  }

  // ── Model Providers (API fuel) ──
  // Discover which BYOK API providers are configured locally via the provider registry
  // (@agent-os/providers). Validation is static/offline and NEVER returns key values — only the
  // env-var name and whether the key is present locally. Keys never leave this machine.
  if (path === '/api/providers' && method === 'GET') {
    const configs = loadProviderConfigsFromEnv();
    providerRegistry
      .validateAll(configs)
      .then((validation) => {
        const available = Object.entries(validation)
          .filter(([, v]) => v.ok)
          .map(([id]) => id);
        const def = defaultProviderId();
        sendJson(res, {
          providers: providerRegistry.list().map((p) => ({ id: p.id, label: p.label })),
          // redactProviderConfig guarantees no secret crosses this boundary.
          configs: Object.fromEntries(Object.entries(configs).map(([id, c]) => [id, redactProviderConfig(c)])),
          validation,
          available,
          default: available.includes(def) ? def : (available[0] ?? null),
        });
      })
      .catch((err: unknown) => {
        sendJson(res, { error: (err as Error).message, providers: [], available: [], default: null }, 500);
      });
    return;
  }

  // ── Presets ──
  if (path === '/api/presets' && method === 'GET') {
    const presetsPath = join(PANEL_DIR, 'presets.json');
    if (existsSync(presetsPath)) {
      sendJson(res, JSON.parse(readFileSync(presetsPath, 'utf-8')));
    } else {
      sendJson(res, {});
    }
    return;
  }

  // ── Memory Tab API (Sprint 46.6.5 — read-only) ──
  // INDEX.aaak.jsonl — full corpus pointer index
  if (path === '/api/memory/index' && method === 'GET') {
    const indexPath = join(REPO_ROOT, 'agent-os/memories/INDEX.aaak.jsonl');
    if (!existsSync(indexPath)) { sendJson(res, { entries: [] }); return; }
    const lines = readFileSync(indexPath, 'utf-8').split('\n').filter(l => l.trim());
    const entries = [];
    for (const ln of lines) {
      try { entries.push(JSON.parse(ln)); } catch { /* skip malformed */ }
    }
    sendJson(res, { entries });
    return;
  }

  // facts.jsonl — folded history + temporal filter (mirrors facts-lib.queryFacts)
  if (path === '/api/memory/facts' && method === 'GET') {
    const factsPath = join(REPO_ROOT, 'agent-os/facts.jsonl');
    if (!existsSync(factsPath)) { sendJson(res, { facts: [] }); return; }
    const lines = readFileSync(factsPath, 'utf-8').split('\n').filter(l => l.trim());
    const all: Array<{
      id?: string; subject?: string; predicate?: string; object?: string;
      valid_from?: string | null; valid_to?: string | null; extracted_at?: string;
      [k: string]: unknown;
    }> = [];
    for (const ln of lines) {
      try { all.push(JSON.parse(ln)); } catch { /* skip */ }
    }

    // Fold history: one canonical entry per id, latest extracted_at wins;
    // file order breaks ties (matches facts-lib.mjs:foldHistory).
    const folded = new Map<string, typeof all[number]>();
    all.forEach((f, idx) => {
      const key = f.id ?? `${f.subject}|${f.predicate}|${f.object}|${f.valid_from ?? ''}`;
      const prev = folded.get(key) as (typeof all[number] & { _idx?: number }) | undefined;
      const fIdx = (f as typeof f & { _idx?: number });
      fIdx._idx = idx;
      if (
        !prev ||
        ((f.extracted_at ?? '') > (prev.extracted_at ?? '')) ||
        ((f.extracted_at ?? '') === (prev.extracted_at ?? '') && idx > (prev._idx ?? -1))
      ) {
        folded.set(key, fIdx);
      }
    });

    const filterSubject = url.searchParams.get('subject') ?? '';
    const filterPredicate = url.searchParams.get('predicate') ?? '';
    const filterObject = url.searchParams.get('object') ?? '';
    const asOf = url.searchParams.get('as_of') ?? '';
    const matches = Array.from(folded.values()).filter(f => {
      if (filterSubject && f.subject !== filterSubject) return false;
      if (filterPredicate && f.predicate !== filterPredicate) return false;
      if (filterObject && f.object !== filterObject) return false;
      if (asOf) {
        if (f.valid_from && f.valid_from > asOf) return false;
        if (f.valid_to && f.valid_to < asOf) return false;
      }
      return true;
    });
    // Strip the internal _idx field before returning
    for (const m of matches) delete (m as { _idx?: number })._idx;
    sendJson(res, { facts: matches });
    return;
  }

  // diary.md — markdown content for one agent
  if (path === '/api/memory/diary' && method === 'GET') {
    const agent = url.searchParams.get('agent') ?? '';
    if (!agent || !/^[a-z][a-z0-9-]+$/.test(agent)) {
      sendJson(res, { error: 'invalid agent slug' }, 400);
      return;
    }
    const diaryPath = join(REPO_ROOT, `agent-os/sub-agents/${agent}/diary.md`);
    if (!existsSync(diaryPath)) {
      sendJson(res, { agent, exists: false, content: '' });
      return;
    }
    const content = readFileSync(diaryPath, 'utf-8');
    const lessonsDir = join(REPO_ROOT, `agent-os/sub-agents/${agent}/lessons`);
    let lessons: Array<{ filename: string; sprint: string; mtime: number }> = [];
    if (existsSync(lessonsDir)) {
      lessons = readdirSync(lessonsDir)
        .filter(f => f.endsWith('.md'))
        .map(f => {
          const stat = statSync(join(lessonsDir, f));
          return { filename: f, sprint: f.replace(/\.md$/, ''), mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
    }
    sendJson(res, { agent, exists: true, content, lessons });
    return;
  }

  // Recent lessons feed across all agents (sorted by mtime desc)
  if (path === '/api/memory/lessons' && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 100);
    const subagentsDir = join(REPO_ROOT, 'agent-os/sub-agents');
    const out: Array<{
      agent: string; sprint: string; path: string; mtime: number;
      title: string; preview: string;
    }> = [];
    if (existsSync(subagentsDir)) {
      const SKIP = new Set(['memories', 'agents', 'skills']);
      for (const agentName of readdirSync(subagentsDir).sort()) {
        if (SKIP.has(agentName)) continue;
        const lessonsDir = join(subagentsDir, agentName, 'lessons');
        if (!existsSync(lessonsDir)) continue;
        for (const fn of readdirSync(lessonsDir)) {
          if (!fn.endsWith('.md')) continue;
          const fp = join(lessonsDir, fn);
          const st = statSync(fp);
          const text = readFileSync(fp, 'utf-8');
          const titleMatch = text.match(/^# (.+)$/m);
          const previewLines = text.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
          out.push({
            agent: agentName,
            sprint: fn.replace(/\.md$/, ''),
            path: `agent-os/sub-agents/${agentName}/lessons/${fn}`,
            mtime: st.mtimeMs,
            title: titleMatch ? titleMatch[1] : fn,
            preview: previewLines.slice(0, 2).join(' ').slice(0, 200),
          });
        }
      }
    }
    out.sort((a, b) => b.mtime - a.mtime);
    sendJson(res, { lessons: out.slice(0, limit) });
    return;
  }

  // GET /api/memory/spawn-prompt?agent=<slug> — returns the rendered
  // Diary + Routed Diaries L1 block for the given agent (Sprint 46.6.7
  // helper now exposed to every spawn path; Sprint 46.6.9 item 2).
  if (path === '/api/memory/spawn-prompt' && method === 'GET') {
    const agent = url.searchParams.get('agent') ?? '';
    if (!agent || !/^[a-z][a-z0-9-]+$/.test(agent)) {
      sendJson(res, { error: 'invalid agent slug' }, 400);
      return;
    }
    try {
      const { execFileSync } = await import('node:child_process');
      const out = execFileSync(
        'bash',
        ['agent-os/scripts/render-spawn-prompt.sh', agent],
        { encoding: 'utf-8', cwd: REPO_ROOT, env: { ...process.env } }
      );
      sendJson(res, { agent, prompt: out });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, { error: msg }, 500);
    }
    return;
  }

  // GET /api/memory/activity?limit=N — recent processed spawn-requests
  // for the Panel Activity sub-tab (Sprint 46.6.9 item 6). Reads from
  // .claude/spawn-requests/consumed/ + the monthly archive.
  if (path === '/api/memory/activity' && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);
    const consumedDir = join(REPO_ROOT, '.claude/spawn-requests/consumed');
    const archiveDir  = join(REPO_ROOT, 'agent-os/spawn-requests-archive');
    type ActivityRow = {
      sprint: string; processed_at: string; branch?: string;
      diary_writes: number; rollovers: number; fact_emitted: boolean;
      source: 'consumed' | 'archive';
    };
    const out: ActivityRow[] = [];
    if (existsSync(consumedDir)) {
      for (const fn of readdirSync(consumedDir)) {
        if (!fn.startsWith('post-sprint-memory-') || !fn.endsWith('.json')) continue;
        try {
          const j = JSON.parse(readFileSync(join(consumedDir, fn), 'utf-8'));
          out.push({
            sprint: j.sprint || '?',
            processed_at: j.processed_at || '',
            branch: j.branch,
            diary_writes: j.diary_writes ?? 0,
            rollovers: j.rollovers ?? 0,
            fact_emitted: !!j.fact_emitted,
            source: 'consumed',
          });
        } catch { /* skip */ }
      }
    }
    if (existsSync(archiveDir)) {
      for (const af of readdirSync(archiveDir)) {
        if (!af.endsWith('.jsonl')) continue;
        const text = readFileSync(join(archiveDir, af), 'utf-8');
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            const j = JSON.parse(line);
            out.push({
              sprint: j.sprint || '?',
              processed_at: j.processed_at || '',
              branch: j.branch,
              diary_writes: j.diary_writes ?? 0,
              rollovers: j.rollovers ?? 0,
              fact_emitted: !!j.fact_emitted,
              source: 'archive',
            });
          } catch { /* skip */ }
        }
      }
    }
    out.sort((a, b) => (b.processed_at || '').localeCompare(a.processed_at || ''));
    sendJson(res, { activity: out.slice(0, limit) });
    return;
  }

  // GET /api/memory/recall/status — exposes whether semantic recall is on
  // (Sprint 46.6.8). Used by the Memory tab to decide whether to render the
  // semantic-search input.
  if (path === '/api/memory/recall/status' && method === 'GET') {
    const mode = (process.env.MEMORY_SEMANTIC_RECALL || 'off').toLowerCase();
    sendJson(res, { enabled: mode !== 'off', mode });
    return;
  }

  // GET /api/memory/recall?q=<query>&top=<N>&corpus=<index|diaries> —
  // delegates to embeddings-recall.sh; returns ranked matches as JSON.
  if (path === '/api/memory/recall' && method === 'GET') {
    const mode = (process.env.MEMORY_SEMANTIC_RECALL || 'off').toLowerCase();
    if (mode === 'off') {
      sendJson(res, { error: 'MEMORY_SEMANTIC_RECALL=off' }, 400);
      return;
    }
    const q = url.searchParams.get('q') || '';
    if (!q.trim()) { sendJson(res, { error: 'q required' }, 400); return; }
    const top = url.searchParams.get('top') || '10';
    const corpus = url.searchParams.get('corpus') || '';
    try {
      const { execFileSync } = await import('node:child_process');
      const args = ['agent-os/scripts/embeddings-recall.sh', q, '--top', top];
      if (corpus) { args.push('--corpus', corpus); }
      const out = execFileSync('bash', args, {
        encoding: 'utf-8',
        cwd: REPO_ROOT,
        env: { ...process.env },
      });
      // The CLI prints `score [corpus] doc_id` per line on stdout
      // (the trailing summary line goes to stderr).
      const lines = out.split('\n').filter(l => l.trim() && !l.startsWith('('));
      const results = lines.map(line => {
        const m = line.match(/^([\d.]+)\s+\[([^\]]+)\]\s+(.+)$/);
        return m ? { score: parseFloat(m[1]), corpus: m[2], doc_id: m[3] } : null;
      }).filter(Boolean);
      sendJson(res, { results, model: process.env.MEMORY_SEMANTIC_RECALL_MODEL || 'local:tfidf-v1' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, { error: msg }, 500);
    }
    return;
  }

  // GET /api/memory/file?path=<rel-path-under-agent-os/> — opens any of the
  // files referenced by INDEX.aaak so the Index sub-tab can render them.
  // Strict allowlist: only paths under agent-os/memories/ or
  // agent-os/sub-agents/ are servable.
  if (path === '/api/memory/file' && method === 'GET') {
    const rel = url.searchParams.get('path') ?? '';
    if (!rel.match(/^agent-os\/(memories|sub-agents)\/[A-Za-z0-9_./-]+\.md$/)) {
      sendJson(res, { error: 'invalid path' }, 400);
      return;
    }
    if (rel.includes('..')) { sendJson(res, { error: 'invalid path' }, 400); return; }
    const fp = join(REPO_ROOT, rel);
    if (!fp.startsWith(REPO_ROOT)) { sendJson(res, { error: 'invalid path' }, 400); return; }
    if (!existsSync(fp)) { sendJson(res, { error: 'not found' }, 404); return; }
    sendJson(res, { path: rel, content: readFileSync(fp, 'utf-8') });
    return;
  }

  // ── Static File Serving ──
  // Serve any file from the panel directory
  let filePath = path === '/' ? '/index.html' : path;

  // SPA: serve index.html for tab routes
  if (filePath.startsWith('/tab/')) filePath = '/index.html';

  const fullPath = join(PANEL_DIR, filePath);

  // Security: prevent directory traversal
  if (!fullPath.startsWith(PANEL_DIR)) {
    sendJson(res, { error: 'Forbidden' }, 403);
    return;
  }

  if (existsSync(fullPath) && statSync(fullPath).isFile()) {
    const ext = extname(fullPath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
    let fileContent: Buffer | string = readFileSync(fullPath);
    // Cache-bust JS imports in index.html so tab files always load fresh
    if (filePath === '/index.html') {
      fileContent = fileContent.toString('utf-8').replace(
        /import\s+'\.\/(.+?)\.js'/g,
        (_, p) => `import './${p}.js?t=${Date.now()}'`,
      );
    }
    res.end(fileContent);
    return;
  }

  // 404
  sendJson(res, { error: 'Not found' }, 404);
});

// WebSocket upgrade handler — two paths: /ws (panel clients) and /api/v1/agent-lobby/ws/agent (local lobby)
const panelWss = new WebSocketServer({ noServer: true });
const localLobbyWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', `http://localhost:${PORT}`).pathname;
  if (pathname === '/ws') {
    panelWss.handleUpgrade(request, socket, head, (ws) => panelWss.emit('connection', ws, request));
  } else if (pathname === '/api/v1/agent-lobby/ws/agent') {
    localLobbyWss.handleUpgrade(request, socket, head, (ws) => localLobbyWss.emit('connection', ws, request));
  } else {
    socket.destroy();
  }
});

wss = panelWss as any; // Alias for broadcastWs compatibility
panelWss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

// ── Local Lobby WebSocket Handler ──
localLobbyWss.on('connection', (ws: WebSocket) => {
  let agentId: string | null = null;
  let registered = false;

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      // Registration
      if (msg.type === 'lobby-register' && !registered) {
        agentId = `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
        registered = true;
        const agent = {
          agent_id: agentId,
          display_name: msg.display_name || agentId,
          agent_role: msg.agent_role || '',
          status: 'idle',
          current_work: '',
          cwd: msg.cwd,
          branch: msg.branch,
          relay_port: msg.relay_port,
          pid: msg.pid,
          last_heartbeat: new Date().toISOString(),
          model: msg.model,
          runtime: msg.runtime,
        };
        localLobbyAgents.set(agentId, agent);
        localLobbyAgentConns.set(agentId, ws);

        // Send registration confirmation
        ws.send(JSON.stringify({ type: 'lobby-registered', agent_id: agentId, lobby_id: `local-${PANEL_ID}` }));

        // Send roster
        ws.send(JSON.stringify({ type: 'lobby-roster', agents: [...localLobbyAgents.values()] }));

        // Notify boss if set
        if (localLobbyBossId) {
          ws.send(JSON.stringify({ type: 'lobby-boss-appointed', agent_id: localLobbyBossId }));
        }

        // Broadcast join to all other agents + panel
        for (const [id, conn] of localLobbyAgentConns) {
          if (id !== agentId && conn.readyState === WebSocket.OPEN) {
            conn.send(JSON.stringify({ type: 'lobby-agent-joined', agent }));
          }
        }
        broadcastWs('lobby-agent-update', { type: 'lobby-agent-joined', agent });

        // System message
        const sysMsg = { message_id: `msg-${Date.now()}`, from_agent_id: 'system', to_agent_id: 'all', message_type: 'system', content: `**${agent.display_name}** joined the lobby.`, created_at: new Date().toISOString() };
        localLobbyMessages.push(sysMsg);
        if (localLobbyMessages.length > 500) localLobbyMessages.splice(0, localLobbyMessages.length - 500);
        broadcastWs('lobby-message', sysMsg);

        // Auto-appoint first agent as boss if none set
        if (!localLobbyBossId) {
          localLobbyBossId = agentId;
          lobbyBossAgentId = agentId;
          for (const [, conn] of localLobbyAgentConns) {
            if (conn.readyState === WebSocket.OPEN) {
              conn.send(JSON.stringify({ type: 'lobby-boss-appointed', agent_id: agentId }));
            }
          }
          broadcastWs('lobby-boss-update', { agent_id: agentId, type: 'appointed' });
          const bossMsg = { message_id: `msg-${Date.now()}`, from_agent_id: 'system', to_agent_id: 'all', message_type: 'system', content: `**${agent.display_name}** was auto-appointed as **Boss Agent**.`, created_at: new Date().toISOString() };
          localLobbyMessages.push(bossMsg);
          broadcastWs('lobby-message', bossMsg);
        }

        console.log(`Local lobby: agent registered — ${agent.display_name} (${agentId})`);
        return;
      }

      if (!registered || !agentId) {
        ws.send(JSON.stringify({ type: 'lobby-error', error: 'Must register first' }));
        return;
      }

      // Heartbeat
      if (msg.type === 'lobby-heartbeat') {
        const agent = localLobbyAgents.get(agentId);
        if (agent) {
          agent.status = msg.status || 'idle';
          agent.current_work = msg.current_work || '';
          agent.last_heartbeat = new Date().toISOString();
        }
        return;
      }

      // Message routing
      if (msg.type === 'lobby-message') {
        const isBoss = agentId === localLobbyBossId;
        const toId = msg.to_agent_id || 'all';
        const lobbyMsg = {
          message_id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          from_agent_id: agentId,
          to_agent_id: toId,
          message_type: msg.message_type || 'chat',
          content: msg.content || '',
          created_at: new Date().toISOString(),
          from_display_name: localLobbyAgents.get(agentId)?.display_name || agentId,
          to_display_name: toId === 'all' ? '*' : (localLobbyAgents.get(toId)?.display_name || toId),
        };
        localLobbyMessages.push(lobbyMsg);
        if (localLobbyMessages.length > 500) localLobbyMessages.splice(0, localLobbyMessages.length - 500);

        if (msg.to_agent_id === 'all') {
          if (!isBoss) {
            // Non-boss broadcast blocked — check for HAND raise pattern
            const content = msg.content || '';
            const handMatch = content.match(/^HAND\s+\S+\s*[—–-]\s*\[?(\w+)\]?[:\s]*(.+)/i);
            if (handMatch) {
              const category = handMatch[1] || 'general';
              const reason = handMatch[2]?.trim() || content;
              const agentName = localLobbyAgents.get(agentId)?.display_name || agentId;
              // Create system message for the HAND raise
              const handSysMsg = {
                message_id: `msg-${Date.now()}-hand`,
                from_agent_id: 'system',
                to_agent_id: 'all',
                message_type: 'system',
                content: `🤚 **${agentName}** raised hand [${category}]: ${reason}`,
                created_at: new Date().toISOString(),
              };
              localLobbyMessages.push(handSysMsg);
              if (localLobbyMessages.length > 500) localLobbyMessages.splice(0, localLobbyMessages.length - 500);
              // Broadcast HAND to all agents + panel
              for (const [id, conn2] of localLobbyAgentConns) {
                if (conn2.readyState === WebSocket.OPEN) {
                  conn2.send(JSON.stringify({ type: 'lobby-message-received', message: handSysMsg }));
                  conn2.send(JSON.stringify({ type: 'lobby-hand-raised', hand: { agent_id: agentId, display_name: agentName, category, reason, raised_at: new Date().toISOString() } }));
                }
              }
              broadcastWs('lobby-message', handSysMsg);
              // Create a request for human approval
              const request = {
                request_id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                agent_id: agentId,
                agent_display_name: agentName,
                title: `HAND: ${agentName} — ${category}`,
                description: reason,
                category: 'hand_raise',
                status: 'pending',
                created_at: new Date().toISOString(),
              };
              localLobbyRequests.push(request);
              broadcastWs('lobby-request', request);
              return;
            }
            // Not a HAND raise — block
            ws.send(JSON.stringify({ type: 'lobby-error', error: 'Only Boss Agent can broadcast. Use HAND [Name] — [category]: [reason] to raise a hand.' }));
            return;
          }
          // Boss broadcast → all agents
          for (const [id, conn] of localLobbyAgentConns) {
            if (id !== agentId && conn.readyState === WebSocket.OPEN) {
              conn.send(JSON.stringify({ type: 'lobby-message-received', message: lobbyMsg }));
            }
          }
        } else {
          // Direct message → specific agent
          const targetConn = localLobbyAgentConns.get(msg.to_agent_id);
          if (targetConn && targetConn.readyState === WebSocket.OPEN) {
            targetConn.send(JSON.stringify({ type: 'lobby-message-received', message: lobbyMsg }));
          } else {
            ws.send(JSON.stringify({ type: 'lobby-error', error: `Agent ${msg.to_agent_id} is not connected.` }));
          }
        }

        // Always broadcast to panel clients
        broadcastWs('lobby-message', lobbyMsg);
        return;
      }

      // Request handling (agents submit approval requests)
      if (msg.type === 'lobby-request') {
        const request = {
          request_id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          agent_id: agentId,
          agent_display_name: localLobbyAgents.get(agentId)?.display_name || agentId,
          title: msg.title || 'Approval Request',
          description: msg.description || '',
          category: msg.category || 'general',
          context: msg.context || '',
          status: 'pending',
          created_at: new Date().toISOString(),
        };
        localLobbyRequests.push(request);
        broadcastWs('lobby-request', request);
        // Notify the requesting agent
        ws.send(JSON.stringify({ type: 'lobby-request-ack', request_id: request.request_id }));
        return;
      }

      // HAND raise handling (agents request floor access)
      if (msg.type === 'lobby-hand-raise') {
        const handMsg = {
          message_id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          from_agent_id: 'system',
          to_agent_id: 'all',
          message_type: 'system',
          content: `🤚 **${localLobbyAgents.get(agentId)?.display_name || agentId}** raised hand [${msg.reason || 'general'}]: ${msg.content || ''}`,
          created_at: new Date().toISOString(),
        };
        localLobbyMessages.push(handMsg);
        if (localLobbyMessages.length > 500) localLobbyMessages.splice(0, localLobbyMessages.length - 500);
        // Broadcast to all agents (including boss)
        for (const [id, conn] of localLobbyAgentConns) {
          if (conn.readyState === WebSocket.OPEN) {
            conn.send(JSON.stringify({ type: 'lobby-message-received', message: handMsg }));
          }
        }
        broadcastWs('lobby-message', handMsg);
        return;
      }

      // Task creation (boss agent or human creates tasks)
      if (msg.type === 'lobby-task-create') {
        const isBoss = agentId === localLobbyBossId;
        if (!isBoss) {
          ws.send(JSON.stringify({ type: 'lobby-error', error: 'Only Boss Agent can create tasks' }));
          return;
        }
        const task = {
          task_id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: msg.title || 'Untitled',
          description: msg.description || '',
          assigned_to: msg.assigned_to || '',
          priority: msg.priority || 'normal',
          category: msg.category || 'general',
          files: msg.files || [],
          status: 'pending',
          created_by: agentId,
          created_at: new Date().toISOString(),
        };
        localLobbyTasks.push(task);
        // Notify assigned agent
        if (task.assigned_to) {
          const targetConn = localLobbyAgentConns.get(task.assigned_to);
          if (targetConn && targetConn.readyState === WebSocket.OPEN) {
            targetConn.send(JSON.stringify({ type: 'lobby-task-assigned', task }));
          }
        }
        // Also write to tasks.jsonl for Panel Tasks tab
        appendFileSync(TASKS_FILE, JSON.stringify({ ...task, source: 'lobby' }) + '\n');
        broadcastWs('lobby-task-update', { type: 'lobby-task-assigned', task });
        ws.send(JSON.stringify({ type: 'lobby-task-created', task }));
        return;
      }
    } catch { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    if (agentId) {
      const agent = localLobbyAgents.get(agentId);
      localLobbyAgents.delete(agentId);
      localLobbyAgentConns.delete(agentId);
      // Broadcast leave
      for (const [, conn] of localLobbyAgentConns) {
        if (conn.readyState === WebSocket.OPEN) {
          conn.send(JSON.stringify({ type: 'lobby-agent-left', agent_id: agentId }));
        }
      }
      broadcastWs('lobby-agent-update', { type: 'lobby-agent-left', agent_id: agentId });
      // If boss left, clear boss
      if (agentId === localLobbyBossId) {
        localLobbyBossId = null;
        lobbyBossAgentId = null;
        broadcastWs('lobby-boss-update', { agent_id: null, type: 'lost' });
        const lostMsg = { message_id: `msg-${Date.now()}`, from_agent_id: 'system', to_agent_id: 'all', message_type: 'system', content: `**Boss Agent disconnected.** Appoint a new Boss Agent.`, created_at: new Date().toISOString() };
        localLobbyMessages.push(lostMsg);
        broadcastWs('lobby-message', lostMsg);
      }
      console.log(`Local lobby: agent disconnected — ${agent?.display_name || agentId}`);
    }
  });

  ws.on('error', () => { ws.close(); });
});

// Start file watchers
watchFile(BUS_FILE, 'messages');
watchFile(OBS_FILE, 'observations');
watchFile(TASKS_FILE, 'tasks');

// ── Auto-start Relay Server ──
let relayProcess: ChildProcess | null = null;
let relayStatus: 'stopped' | 'starting' | 'running' | 'failed' = 'stopped';

function startRelay(): void {
  const relayPath = join(REPO_ROOT, 'packages/relay/src/relay-server.ts');
  if (!existsSync(relayPath)) {
    console.log('Relay: relay-server.ts not found, skipping auto-start');
    relayStatus = 'failed';
    return;
  }

  relayStatus = 'starting';
  const relayArgs = [relayPath, '--port', String(RELAY_PORT)];
  if (DEFAULT_LOBBY_URL) relayArgs.push('--lobby', DEFAULT_LOBBY_URL);
  // Register relay as a general-purpose agent so the boss can assign work to it
  relayArgs.push('--agent-role', 'general');

  const logFile = join(LOGS_DIR, 'relay.log');

  try {
    relayProcess = spawnTsx(relayArgs, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const logLines: string[] = [];
    const appendLog = (data: Buffer) => {
      const text = data.toString();
      const lines = text.split('\n');
      logLines.push(...lines);
      if (logLines.length > 500) logLines.splice(0, logLines.length - 500);
      try { writeFileSync(logFile, logLines.join('\n')); } catch { /* ignore */ }

      // Detect successful start
      if (text.includes('listening') || text.includes('Relay server')) {
        relayStatus = 'running';
        console.log(`Relay: running on port ${RELAY_PORT}`);
        broadcastWs('relay-status', { status: 'running', port: RELAY_PORT });
      }
    };

    relayProcess.stdout?.on('data', appendLog);
    relayProcess.stderr?.on('data', appendLog);

    relayProcess.on('exit', (code) => {
      relayStatus = 'stopped';
      relayProcess = null;
      console.log(`Relay: exited with code ${code}`);
      broadcastWs('relay-status', { status: 'stopped' });
    });

    console.log(`Relay: starting on port ${RELAY_PORT} (PID: ${relayProcess.pid})`);

    // Mark as running after 3s if no log output detected it
    setTimeout(() => {
      if (relayStatus === 'starting') {
        relayStatus = 'running';
        broadcastWs('relay-status', { status: 'running', port: RELAY_PORT });
      }
    }, 3000);

  } catch (err) {
    console.error('Relay: failed to start:', err);
    relayStatus = 'failed';
  }
}

function stopRelay(): void {
  if (relayProcess) {
    relayProcess.kill('SIGTERM');
    setTimeout(() => {
      if (relayProcess?.exitCode === null) relayProcess?.kill('SIGKILL');
    }, 5000);
    relayProcess = null;
    relayStatus = 'stopped';
  }
}

// ── Built-in Scheduler ──
// Checks configured task times against UTC clock every 60s.
// Prevents double execution by comparing last_run date with today's date.
function checkScheduledTasks(): void {
  try {
    const config = getScheduledConfig() as { schedules?: Record<string, { enabled?: boolean; time_utc?: string; prompt?: string }> };
    const schedules = config.schedules ?? {};
    const now = new Date();
    const nowHHMM = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
    const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

    for (const [name, cfg] of Object.entries(schedules)) {
      if (!cfg.enabled || !cfg.time_utc) continue;
      if (cfg.time_utc !== nowHHMM) continue;
      if (scheduledProcesses.has(name)) continue; // already running

      // Check if already ran today
      const state = getScheduledTaskState(name);
      if (state?.last_run) {
        const lastRunDate = String(state.last_run).slice(0, 10);
        if (lastRunDate === todayStr) continue; // already ran today
      }

      const localTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      console.log(`Scheduler: auto-triggering ${name} (${localTime} local / ${cfg.time_utc} UTC)`);
      const result = triggerScheduledTask(name);
      if (result.ok) {
        broadcastWs('scheduled-trigger', { name, trigger: 'auto', time_utc: cfg.time_utc });
      } else {
        console.log(`Scheduler: failed to trigger ${name}: ${result.error}`);
      }
    }
  } catch (err) {
    console.error('Scheduler: check failed:', err);
  }
}

// Export relay status for the tray app
(globalThis as any).__agentOsPanelState = {
  getRelayStatus: () => relayStatus,
  getRunningCount: () => [...runningProcesses.keys()].length,
  getTotalAgents: () => { try { return discoverAgents().length; } catch { return 0; } },
  port: PORT,
  relayPort: RELAY_PORT,
};

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Agent OS Panel running at http://localhost:${PORT}`);
  console.log(`WebSocket at ws://localhost:${PORT}/ws`);
  console.log(`Discovered ${discoverAgents().length} agents in ${AGENTS_DIR}`);
  if (DEFAULT_LOBBY_URL) console.log(`Default lobby: ${DEFAULT_LOBBY_URL}`);

  // Auto-start relay unless --no-relay
  if (!NO_RELAY) {
    startRelay();
  } else {
    console.log('Relay: auto-start disabled (--no-relay)');
  }

  // Connect to staging lobby WebSocket (for sending messages to agents)
  if (DEFAULT_LOBBY_URL) {
    setTimeout(connectLobbyWs, 3000); // Wait for lobby to be ready
  }

  // Start built-in scheduler (check every 60s)
  setInterval(checkScheduledTasks, 60_000);
  console.log('Scheduler: built-in scheduler active (60s check interval)');

  // Save local lobby state every 30s
  setInterval(saveLocalLobbyState, 30_000);
  console.log(`Mode: ${activeLobbyUrl ? 'Agent Swarm (' + activeLobbyUrl + ')' : 'Local Agent Mode'}`);
});

// Graceful shutdown
const shutdown = () => {
  console.log('Shutting down...');
  if (lobbyClient) { try { lobbyClient.close(); } catch { /* ignore */ } }
  stopRelay();
  for (const slug of [...runningProcesses.keys()]) stopAgent(slug);
  for (const name of [...scheduledProcesses.keys()]) {
    const proc = scheduledProcesses.get(name);
    proc?.kill('SIGTERM');
  }
  for (const client of wsClients) {
    try { client.close(); } catch { /* ignore */ }
  }
  server.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
