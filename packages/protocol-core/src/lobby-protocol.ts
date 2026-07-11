// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen
// See LICENSE for licensing terms.

/**
 * Shared types for the Agent Lobby — multi-session coordination layer
 * inside UI Assist. Enables multiple Claude CLI sessions to connect,
 * identify themselves, communicate, and coordinate work through a
 * human-reviewed staging interface.
 *
 * Sprint: Multi-Session UI Assist — Agent Lobby (Phase 1)
 */

import type { IdentityVerificationStatus, LobbyJoinPolicy } from './agent-identity.js';

// ── Agent Session ──

/** Status of a connected agent session in the lobby. */
export type LobbyAgentStatus =
  | 'connecting'
  | 'idle'
  | 'working'
  | 'waiting_review'
  | 'disconnected';

/** Role a connected session can hold in the lobby. */
export type LobbyAgentRole = 'agent' | 'boss_agent' | 'human';

/** Participant type — distinguishes CLI agents from browser-based humans. */
export type LobbyParticipantType = 'cli_agent' | 'human';

/** A connected session (agent or human) registered in the lobby. */
export interface LobbyAgent {
  /** Unique agent session ID (assigned on registration). */
  agent_id: string;
  /** Human-readable display name (e.g. "claude-frontend-1" or "Alice"). */
  display_name: string;
  /** Role within the lobby. */
  role: LobbyAgentRole;
  /** Participant type — CLI agent or browser human. Defaults to 'cli_agent'. */
  participant_type: LobbyParticipantType;
  /** Current operational status. */
  status: LobbyAgentStatus;
  /** One-line summary of current work. */
  current_work: string;
  /** Git branch the session is working on. */
  branch?: string;
  /** Working directory path. */
  cwd?: string;
  /** Process ID on the developer's machine. */
  pid?: number;
  /** Relay server port this agent connected through. */
  relay_port?: number;
  /** Agent OS specialist role (e.g. "frontend-specialist", "compliance-specialist"). */
  agent_role?: string;
  /** True when this agent currently holds the Boss role (mirrors LobbySession.boss_agent_id). */
  is_boss?: boolean;
  /** ISO timestamp of registration. */
  registered_at: string;
  /** ISO timestamp of last heartbeat. */
  last_seen: string;
  /** ISO timestamp of disconnection (set when status becomes 'disconnected'). */
  disconnected_at?: string;
  /**
   * Identity verification status stamped at join time (Phase 8) — drives the roster identity badge.
   * Absent/`undefined` means no reference was presented (an unverified/anonymous participant).
   */
  identity_status?: IdentityVerificationStatus;
  /** Non-secret registry reference (the DID) the agent presented, when any. Never a key. */
  identity_ref?: string;
  /** API / Model used by the agent (e.g. "gpt-4o-mini"). */
  model?: string;
  /** Runtime environment (e.g. "Claude CLI", "Codex CLI", "API"). */
  runtime?: string;
}

// ── Lobby Messages (inter-agent communication) ──

/** Types of messages exchanged between agents in the lobby. */
export type LobbyMessageType =
  | 'chat' // Free-form text between agents
  | 'status_update' // Agent broadcasting status change
  | 'handoff' // Work handoff from one agent to another
  | 'coordination' // Sprint/task coordination directive
  | 'system'; // System-generated (join, leave, role change)

/** A message in the lobby message stream. */
export interface LobbyMessage {
  /** Unique message ID. */
  message_id: string;
  /** Monotonic sequence number within the lobby — guarantees total ordering. */
  seq: number;
  /** ID of the sending agent (or 'system' for system messages). */
  from_agent_id: string;
  /** Target agent ID, or 'all' for broadcast. */
  to_agent_id: string;
  /** Message classification. */
  message_type: LobbyMessageType;
  /** Message body (markdown-supported). */
  content: string;
  /** ISO timestamp. */
  created_at: string;
  /** Whether the recipient has acknowledged receipt. */
  delivered: boolean;
}

// ── Lobby Requests (human approval workflow) ──

/** Categories of actions that require human approval. */
export type LobbyRequestCategory =
  | 'commit_approval' // Agent wants to commit code
  | 'pr_review' // Agent wants PR reviewed / created
  | 'merge_readiness' // Agent declares work merge-ready
  | 'sprint_closure' // Agent requests sprint close-out
  | 'work_handoff' // Agent proposes handing work to another agent
  | 'scope_change' // Agent proposes scope change
  | 'general' // General request for human guidance
  | 'hand_raise'; // Agent raised hand — needs attention (blocker/risk/assignment/completion/clarification)

/** Status of a human approval request. */
export type LobbyRequestStatus = 'pending' | 'approved' | 'rejected' | 'deferred';

/** A request from an agent session to the human reviewer. */
export interface LobbyRequest {
  /** Unique request ID. */
  request_id: string;
  /** ID of the requesting agent. */
  agent_id: string;
  /** Display name of the requesting agent (denormalized for UI). */
  agent_display_name: string;
  /** Request category. */
  category: LobbyRequestCategory;
  /** Short title. */
  title: string;
  /** Detailed description (markdown). */
  description: string;
  /** Current status. */
  status: LobbyRequestStatus;
  /** Optional structured context (files changed, branch, diff summary, etc.). */
  context?: Record<string, unknown>;
  /** ISO timestamp of creation. */
  created_at: string;
  /** ISO timestamp of last status change. */
  updated_at: string;
  /** ID of the human who decided (if decided). */
  decided_by?: string;
  /** ISO timestamp of decision. */
  decided_at?: string;
  /** Human reviewer's notes on the decision. */
  decision_notes?: string;
}

// ── Lobby Session (top-level lobby state persisted in MongoDB) ──

/** Status of the lobby itself. */
export type LobbyStatus = 'active' | 'paused' | 'closed';

/** Lobby visibility — controls who may join (charter §10/§19). */
export type LobbyVisibility =
  | 'public' // anyone may join; abuse controls (rate limits) apply
  | 'private'; // only allowlisted / verified agents may join

/** Top-level lobby session document. */
export interface LobbySession {
  /** Unique lobby session ID. */
  lobby_id: string;
  /** Organization that owns this lobby. */
  org_id: string;
  /** Human-readable lobby name (e.g. "Sprint 34.0 Coordination"). */
  name: string;
  /** Current lobby status. */
  status: LobbyStatus;
  /** Visibility — defaults to 'public' when unset. */
  visibility?: LobbyVisibility;
  /**
   * Private-lobby access policy (Phase 8 ladder: none → registered → allowlisted →
   * verified_human_link). When unset, behavior derives from `visibility`: a private lobby defaults
   * to `allowlisted` (back-compat with the Phase 7 allowlist), a public lobby to `none`.
   */
  join_policy?: LobbyJoinPolicy;
  /**
   * Join allowlist for a private lobby. An entry matches an agent's presented join token (its
   * verified identity reference / DID, Phase 8) or display name. Empty/undefined on a public lobby.
   */
  allowlist?: string[];
  /** ID of the agent currently appointed as Boss Agent (if any). */
  boss_agent_id?: string;
  /** IDs of all currently connected agents. */
  connected_agent_ids: string[];
  /** Monotonic message sequence counter (incremented atomically per message). */
  message_seq: number;
  /** ISO timestamp of creation. */
  created_at: string;
  /** ISO timestamp of last activity. */
  updated_at: string;
  /** ID of the human who created the lobby. */
  created_by: string;
}

// ── WebSocket Protocol Messages (relay ↔ lobby coordinator) ──

/** Messages from a relay-connected agent to the lobby coordinator. */
export type AgentToLobbyMessage =
  | {
      type: 'lobby-register';
      display_name: string;
      cwd?: string;
      branch?: string;
      pid?: number;
      relay_port?: number;
      agent_role?: string;
      /** Optional join token for a private lobby — matched against the lobby allowlist. */
      join_token?: string;
      /** Marks a browser human participant (exempt from floor control). Defaults to cli_agent. */
      participant_type?: LobbyParticipantType;
      /** API / Model used by the agent. */
      model?: string;
      /** Runtime environment. */
      runtime?: string;
    }
  | { type: 'lobby-heartbeat'; current_work: string; status: LobbyAgentStatus }
  | { type: 'lobby-message'; to_agent_id: string; message_type: LobbyMessageType; content: string }
  | {
      type: 'lobby-request';
      category: LobbyRequestCategory;
      title: string;
      description: string;
      context?: Record<string, unknown>;
    }
  | { type: 'lobby-unregister' }
  | { type: 'lobby-human-join'; display_name: string; role: string }
  | {
      type: 'lobby-task-update';
      task_id: string;
      status?: LobbyTaskStatus;
      progress?: string;
      progress_pct?: number;
      result?: string;
      result_files?: string[];
    }
  | { type: 'lobby-hand-raise'; category: HandRaiseCategory; reason: string }
  | {
      type: 'lobby-task-create';
      assigned_to: string;
      title: string;
      description: string;
      priority?: 'critical' | 'high' | 'normal' | 'low';
      category?: LobbyTaskCategory;
      files?: string[];
    }
  | { type: 'lobby-boss-appoint'; agent_id: string }
  | { type: 'lobby-role-change'; agent_id: string; agent_role: string };

/** Messages from the lobby coordinator back to a relay-connected agent. */
export type LobbyToAgentMessage =
  | { type: 'lobby-registered'; agent_id: string; lobby_id: string }
  | { type: 'lobby-agent-joined'; agent: LobbyAgent }
  | { type: 'lobby-agent-left'; agent_id: string }
  | { type: 'lobby-agent-updated'; agent: LobbyAgent }
  | { type: 'lobby-message-received'; message: LobbyMessage }
  | { type: 'lobby-request-created'; request: LobbyRequest }
  | { type: 'lobby-request-decided'; request: LobbyRequest }
  | { type: 'lobby-roster'; agents: LobbyAgent[] }
  | { type: 'lobby-boss-appointed'; agent_id: string }
  | { type: 'lobby-boss-lost'; lost_agent_id: string; connected_agents: LobbyAgent[] }
  | { type: 'lobby-hand-raised'; hand: HandRaise }
  | { type: 'lobby-hand-cleared'; agent_id: string }
  | { type: 'lobby-task-assigned'; task: LobbyTask }
  | { type: 'lobby-task-updated'; task: LobbyTask }
  | { type: 'lobby-task-cancelled'; task_id: string; reason?: string }
  | { type: 'lobby-task-deleted'; task_id: string }
  | { type: 'lobby-error'; error: string };

// ── Hand-Raise System ──

/** Structured categories for hand-raises — replaces free-form reasons. */
export type HandRaiseCategory =
  | 'blocker' // Something is blocking progress — immediate attention needed
  | 'risk' // Identified a risk that may affect go-live or sprint goals
  | 'needs_assignment' // Agent needs work assigned or clarification on current task
  | 'completion' // Agent completed assigned work and is reporting back
  | 'clarification'; // Agent needs clarification before proceeding

/** A tracked hand-raise from an agent. */
export interface HandRaise {
  agent_id: string;
  agent_name: string;
  category: HandRaiseCategory;
  reason: string;
  raised_at: string;
}

// ── Task-Based Coordination (Sprint 35.5.0) ──

/** Status of a lobby task through its lifecycle. */
export type LobbyTaskStatus =
  | 'pending' // Created, not yet sent to agent
  | 'assigned' // Sent to agent, awaiting acceptance
  | 'accepted' // Agent acknowledged, will start
  | 'in_progress' // Agent working
  | 'completed' // Agent finished, result attached
  | 'failed' // Agent could not complete
  | 'cancelled'; // Boss cancelled before completion

/** Category of task — maps to agent specialties. */
export type LobbyTaskCategory =
  | 'code_review'
  | 'implementation'
  | 'testing'
  | 'bug_fix'
  | 'analysis'
  | 'documentation'
  | 'deployment'
  | 'general';

/** A structured task assigned to an agent via the control plane. */
export interface LobbyTask {
  /** Unique task ID. */
  task_id: string;
  /** Lobby this task belongs to. */
  lobby_id: string;
  /** Organization owner. */
  org_id: string;
  /** Agent who created/assigned the task (Boss or reviewer). */
  assigned_by: string;
  /** Target agent. */
  assigned_to: string;
  /** ISO timestamp of assignment. */
  assigned_at: string;
  /** Short description (< 100 chars). */
  title: string;
  /** Markdown: what to do, expected output. */
  description: string;
  /** Priority level. */
  priority: 'critical' | 'high' | 'normal' | 'low';
  /** Task category. */
  category: LobbyTaskCategory;
  /** Files to examine/modify. */
  files?: string[];
  /** Git branch context. */
  branch?: string;
  /** Task IDs this depends on. */
  related_tasks?: string[];
  /** Additional structured metadata. */
  context?: Record<string, unknown>;
  /** Current lifecycle status. */
  status: LobbyTaskStatus;
  /** ISO timestamp of acceptance. */
  accepted_at?: string;
  /** ISO timestamp of work start. */
  started_at?: string;
  /** ISO timestamp of completion. */
  completed_at?: string;
  /** Markdown summary of what was done. */
  result?: string;
  /** URL of the Pull Request opened for this task's changes (branch/PR workflow). */
  result_pr_url?: string;
  /** The per-task branch the PR was opened from (used to read that PR's CI check results). */
  result_branch?: string;
  /** Files that were changed. */
  result_files?: string[];
  /** One-line progress status. */
  progress?: string;
  /** 0-100 completion percentage. */
  progress_pct?: number;
  /** Monotonic ordering within lobby. */
  seq: number;
}

/** Payload for creating a task. */
export interface CreateLobbyTaskPayload {
  assigned_to: string;
  title: string;
  description: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  category?: LobbyTaskCategory;
  files?: string[];
  branch?: string;
  related_tasks?: string[];
  context?: Record<string, unknown>;
}

/** Payload for updating a task (agent or boss). */
export interface UpdateLobbyTaskPayload {
  status?: LobbyTaskStatus;
  progress?: string;
  progress_pct?: number;
  result?: string;
  result_files?: string[];
}

// ── API Payloads ──

/** Payload for creating a new lobby session. */
export interface CreateLobbyPayload {
  name: string;
}

/** Payload for deciding on an agent request. */
export interface DecideLobbyRequestPayload {
  status: 'approved' | 'rejected' | 'deferred';
  decision_notes?: string;
}

/** Payload for appointing a Boss Agent. */
export interface AppointBossAgentPayload {
  agent_id: string;
}

/** Payload for creating a lobby on the independent lobby server. */
export interface CreateLobbySessionPayload {
  name: string;
  org_id?: string;
  created_by?: string;
  visibility?: LobbyVisibility;
  join_policy?: LobbyJoinPolicy;
  allowlist?: string[];
}

/**
 * Public discovery response (`GET /api/v1/agent-lobby/discover`). Shape matches what the Panel and
 * relay already parse: `{ lobby: { lobby_id, org_id, name } | null }`.
 */
export interface LobbyDiscoverResponse {
  lobby: {
    lobby_id: string;
    org_id: string;
    name: string;
    visibility?: LobbyVisibility;
    /** The join policy a client must satisfy (so it knows whether to present an identity ref). */
    join_policy?: LobbyJoinPolicy;
  } | null;
}

// ── Event log (durable accountability — charter §19) ──

/** Kinds of auditable lobby events appended to the durable event log. */
export type LobbyEventType =
  | 'lobby_created'
  | 'agent_registered'
  | 'agent_left'
  | 'message_sent'
  | 'message_rejected' // floor control / scoping denial (records the anti-pattern attempt)
  | 'boss_appointed'
  | 'hand_raised'
  | 'task_created'
  | 'task_updated'
  | 'join_denied' // private-lobby access denial
  | 'owner_registered' // Concordium owner identity registered as a credential issuer
  | 'agent_card_published' // agent card metadata published for hosting
  | 'member_invited' // a member was invited to the lobby (management view)
  | 'member_revoked' // a member's access was revoked / kicked
  | 'lobby_settings_updated' // visibility / join policy / allowlist changed
  | 'provider_key_configured' // Hosted Mode: a model-provider API key was set (lobby or agent scope)
  | 'provider_key_revoked' // Hosted Mode: a stored provider key was revoked
  | 'hosted_agent_launched' // Hosted Mode: a server-side agent was launched into the lobby
  | 'hosted_agent_stopped' // Hosted Mode: a server-side agent was stopped
  | 'github_connected' // Hosted Mode: a GitHub App installation was connected to the lobby
  | 'kb_configured' // Hosted Mode: Knowledge Base configured
  | 'github_repo_selected' // Hosted Mode: the working repo/branch was chosen
  | 'scheduled_tasks_configured' // Hosted Mode: daily scheduled tasks configured
  | 'repo_initialized' // Hosted Mode: the Agent OS structure was seeded into the connected repo
  | 'github_disconnected'; // Hosted Mode: the GitHub integration was revoked

/** One append-only entry in a lobby's event log. */
export interface LobbyEvent {
  /** Unique event id. */
  event_id: string;
  /** Lobby this event belongs to. */
  lobby_id: string;
  /** Monotonic sequence within the lobby. */
  seq: number;
  type: LobbyEventType;
  /** Acting agent id (or 'system'). */
  actor_id: string;
  /** ISO timestamp. */
  at: string;
  /** Structured, non-secret detail (e.g. reason for a rejection). */
  detail?: Record<string, unknown>;
}
