// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * LobbyStore — the durable-state seam for the lobby. The in-memory implementation backs Local
 * Mode and the portable Node WS server; a Redis/Postgres implementation backs the remote swarm
 * (apps/lobby-web) without changing the coordinator. All methods are async so a network-backed
 * store drops in unchanged. See IMPLEMENTATION-PLAN.md §9 (durable store).
 */

import type { LobbySession, LobbyAgent, LobbyMessage, LobbyTask, LobbyEvent } from '@agent-os/protocol-core';

export interface LobbyStore {
  createLobby(lobby: LobbySession): Promise<LobbySession>;
  getLobby(lobbyId: string): Promise<LobbySession | undefined>;
  listLobbies(): Promise<LobbySession[]>;
  updateLobby(lobbyId: string, patch: Partial<LobbySession>): Promise<LobbySession | undefined>;

  addAgent(lobbyId: string, agent: LobbyAgent): Promise<void>;
  getAgent(lobbyId: string, agentId: string): Promise<LobbyAgent | undefined>;
  updateAgent(lobbyId: string, agentId: string, patch: Partial<LobbyAgent>): Promise<LobbyAgent | undefined>;
  removeAgent(lobbyId: string, agentId: string): Promise<void>;
  roster(lobbyId: string): Promise<LobbyAgent[]>;

  /** Atomically allocate the next monotonic sequence number within a lobby. */
  nextSeq(lobbyId: string): Promise<number>;

  appendMessage(lobbyId: string, message: LobbyMessage): Promise<void>;
  listMessages(lobbyId: string): Promise<LobbyMessage[]>;

  upsertTask(task: LobbyTask): Promise<void>;
  getTask(lobbyId: string, taskId: string): Promise<LobbyTask | undefined>;

  appendEvent(event: LobbyEvent): Promise<void>;
  listEvents(lobbyId: string): Promise<LobbyEvent[]>;
}

interface LobbyBucket {
  lobby: LobbySession;
  agents: Map<string, LobbyAgent>;
  messages: LobbyMessage[];
  tasks: Map<string, LobbyTask>;
  events: LobbyEvent[];
  seq: number;
}

/** Process-local store — the default for Local Mode and the standalone Node WS server. */
export class InMemoryLobbyStore implements LobbyStore {
  private lobbies = new Map<string, LobbyBucket>();

  private bucket(lobbyId: string): LobbyBucket | undefined {
    return this.lobbies.get(lobbyId);
  }

  async createLobby(lobby: LobbySession): Promise<LobbySession> {
    this.lobbies.set(lobby.lobby_id, {
      lobby,
      agents: new Map(),
      messages: [],
      tasks: new Map(),
      events: [],
      seq: lobby.message_seq ?? 0,
    });
    return lobby;
  }

  async getLobby(lobbyId: string): Promise<LobbySession | undefined> {
    return this.bucket(lobbyId)?.lobby;
  }

  async listLobbies(): Promise<LobbySession[]> {
    return [...this.lobbies.values()].map((b) => b.lobby);
  }

  async updateLobby(lobbyId: string, patch: Partial<LobbySession>): Promise<LobbySession | undefined> {
    const b = this.bucket(lobbyId);
    if (!b) return undefined;
    b.lobby = { ...b.lobby, ...patch, updated_at: new Date().toISOString() };
    return b.lobby;
  }

  async addAgent(lobbyId: string, agent: LobbyAgent): Promise<void> {
    this.bucket(lobbyId)?.agents.set(agent.agent_id, agent);
  }

  async getAgent(lobbyId: string, agentId: string): Promise<LobbyAgent | undefined> {
    return this.bucket(lobbyId)?.agents.get(agentId);
  }

  async updateAgent(lobbyId: string, agentId: string, patch: Partial<LobbyAgent>): Promise<LobbyAgent | undefined> {
    const a = this.bucket(lobbyId)?.agents.get(agentId);
    if (!a) return undefined;
    const updated = { ...a, ...patch, last_seen: patch.last_seen ?? new Date().toISOString() };
    this.bucket(lobbyId)!.agents.set(agentId, updated);
    return updated;
  }

  async removeAgent(lobbyId: string, agentId: string): Promise<void> {
    this.bucket(lobbyId)?.agents.delete(agentId);
  }

  async roster(lobbyId: string): Promise<LobbyAgent[]> {
    // Connection order (registered_at) determines speaking priority — keep it stable.
    return [...(this.bucket(lobbyId)?.agents.values() ?? [])].sort((a, b) =>
      a.registered_at.localeCompare(b.registered_at),
    );
  }

  async nextSeq(lobbyId: string): Promise<number> {
    const b = this.bucket(lobbyId);
    if (!b) return 0;
    b.seq += 1;
    b.lobby.message_seq = b.seq;
    return b.seq;
  }

  async appendMessage(lobbyId: string, message: LobbyMessage): Promise<void> {
    this.bucket(lobbyId)?.messages.push(message);
  }

  async listMessages(lobbyId: string): Promise<LobbyMessage[]> {
    return this.bucket(lobbyId)?.messages ?? [];
  }

  async upsertTask(task: LobbyTask): Promise<void> {
    this.bucket(task.lobby_id)?.tasks.set(task.task_id, task);
  }

  async getTask(lobbyId: string, taskId: string): Promise<LobbyTask | undefined> {
    return this.bucket(lobbyId)?.tasks.get(taskId);
  }

  async appendEvent(event: LobbyEvent): Promise<void> {
    this.bucket(event.lobby_id)?.events.push(event);
  }

  async listEvents(lobbyId: string): Promise<LobbyEvent[]> {
    return this.bucket(lobbyId)?.events ?? [];
  }
}
