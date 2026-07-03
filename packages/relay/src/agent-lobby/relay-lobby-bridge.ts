// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

import { LobbyClient } from '@agent-os/lobby-client';
import type { LobbyAgent, LobbyMessage, LobbyTask } from '@agent-os/protocol-core';

export interface BridgeOptions {
  /** BASE lobby server URL (http/https/ws/wss, no path) — LobbyClient appends the WS path itself. */
  lobbyUrl: string;
  /** Lobby to join; omit to auto-discover (and re-discover after a lobby-server restart). */
  lobbyId?: string;
  orgId?: string;
  agentName: string;
  cwd: string;
  branch: string;
  pid: number;
  relayPort: number;
  agentRole?: string;
  /** The runtime this relay ACTUALLY drives (adapter label) — reported truthfully to the lobby. */
  runtime?: string;
  /** Model override in effect, if any. */
  model?: string;
  /** Identity reference (e.g. Concordium agent DID) presented as the lobby join token. */
  joinToken?: string;
  onLobbyMessage: (msg: any) => Promise<void>;
  log?: (level: string, message: string) => void;
}

export class RelayLobbyBridge {
  private client: LobbyClient;
  private messageBuffer: Array<{ from: string; content: string }> = [];
  private roster: LobbyAgent[] = [];

  currentTask: LobbyTask | null = null;
  currentBossAgentId: string | null = null;

  constructor(options: BridgeOptions) {
    this.client = new LobbyClient({
      lobbyUrl: options.lobbyUrl,
      lobbyId: options.lobbyId,
      orgId: options.orgId,
      register: {
        type: 'lobby-register',
        display_name: options.agentName,
        cwd: options.cwd,
        branch: options.branch,
        pid: options.pid,
        relay_port: options.relayPort,
        agent_role: options.agentRole,
        model: options.model || '—',
        runtime: options.runtime || '—',
        join_token: options.joinToken,
      },
      reconnect: true,
    });

    this.client.onMessage(async (msg) => {
      if (msg.type === 'lobby-message-received') {
        const lobbyMsg = msg.message;
        if (
          lobbyMsg.to_agent_id === this.currentAgentId &&
          lobbyMsg.message_type === 'coordination' &&
          lobbyMsg.content.startsWith('INVITE|')
        ) {
          const newLobbyId = lobbyMsg.content.substring(7);
          console.log(`[lobby-bridge] Received invite to lobby: ${newLobbyId}. Reconnecting...`);
          this.client.close();
          this.client['options'].lobbyId = newLobbyId;
          this.client.lobbyId = newLobbyId;
          this.client['closedByUser'] = false;
          setTimeout(() => {
            this.client.connect().catch((err) => {
              console.error(`[lobby-bridge] Failed to connect to invited lobby ${newLobbyId}:`, err);
            });
          }, 1000);
          return;
        }
      }
      if (msg.type === 'lobby-roster') {
        this.roster = msg.agents || [];
        const boss = this.roster.find(a => a.is_boss || a.role === 'boss_agent');
        if (boss) {
          this.currentBossAgentId = boss.agent_id;
        }
      }
      if (msg.type === 'lobby-boss-appointed') {
        this.currentBossAgentId = msg.agent_id;
      }
      if (msg.type === 'lobby-boss-lost') {
        this.currentBossAgentId = null;
      }
      // Pass the message to the relay message loop
      await options.onLobbyMessage(msg);
    });

  }

  get currentAgentId(): string {
    return this.client.agentId || '';
  }

  setCurrentTask(task: LobbyTask): void {
    this.currentTask = task;
  }

  clearCurrentTask(): void {
    this.currentTask = null;
  }

  updateStatus(status: string, state: any): void {
    this.client.setStatus(state, status);
  }

  getRosterContext(): string {
    if (this.roster.length === 0) return '';
    return `## ACTIVE LOBBY ROSTER\n` + 
      this.roster.map(a => `- ${a.agent_id}: ${a.display_name} (${a.agent_role || 'no role'}) - Status: ${a.status} (Identity: ${a.identity_status || 'unverified'}, Runtime: ${a.runtime || '—'}, Model: ${a.model || '—'})`).join('\n');
  }

  bufferMessage(from: string, content: string): void {
    this.messageBuffer.push({ from, content });
  }

  drainBufferContext(): string {
    if (this.messageBuffer.length === 0) return '';
    const ctx = `### RECENT BUFFERED LOBBY MESSAGES\n` + 
      this.messageBuffer.map(m => `[From Agent ${m.from}]: ${m.content}`).join('\n') +
      `\n--- END OF BUFFERED MESSAGES ---`;
    this.messageBuffer = [];
    return ctx;
  }

  updateTaskProgress(taskId: string, progress: string, progressPct: number): void {
    this.client.send({
      type: 'lobby-task-update',
      task_id: taskId,
      status: 'in_progress',
      progress,
      progress_pct: progressPct,
    });
  }

  completeTask(taskId: string, result: string): void {
    this.client.send({
      type: 'lobby-task-update',
      task_id: taskId,
      status: 'completed',
      result,
    });
  }

  failTask(taskId: string, error: string): void {
    this.client.send({
      type: 'lobby-task-update',
      task_id: taskId,
      status: 'failed',
      result: error,
    });
  }

  raiseHand(category: any, reason: string): void {
    this.client.send({
      type: 'lobby-hand-raise',
      category,
      reason,
    });
  }

  sendMessage(to: string, type: any, content: string): void {
    this.client.send({
      type: 'lobby-message',
      to_agent_id: to,
      message_type: type,
      content,
    });
  }

  createTask(assignedTo: string, title: string, description: string, priority: any, category: any, files?: string[]): void {
    this.client.send({
      type: 'lobby-task-create',
      assigned_to: assignedTo,
      title,
      description,
      priority,
      category,
      files,
    });
  }

  classifyMessage(msg: LobbyMessage): 'buffer' | 'invoke' | 'ignore' {
    if (msg.from_agent_id === this.currentAgentId) return 'ignore';
    const isDirectedToUs = msg.to_agent_id === this.currentAgentId;
    const isBroadcast = msg.to_agent_id === 'all' || msg.to_agent_id === '*';
    
    if (isDirectedToUs) return 'invoke';
    if (isBroadcast) {
      if (this.currentAgentId === this.currentBossAgentId) return 'invoke';
      return 'buffer';
    }
    return 'ignore';
  }

  peekBufferContext(): string {
    if (this.messageBuffer.length === 0) return '';
    return `### RECENT BUFFERED LOBBY MESSAGES\n` + 
      this.messageBuffer.map(m => `[From Agent ${m.from}]: ${m.content}`).join('\n') +
      `\n--- END OF BUFFERED MESSAGES ---`;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  disconnect(): void {
    this.client.close();
  }

  close(): void {
    this.disconnect();
  }
}
