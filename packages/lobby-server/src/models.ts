// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import type { WorkspaceProvider } from '@agent-os/protocol-core';

export interface Lobby {
  id: string;
  name: string;
  description?: string;
  visibility: 'public' | 'private' | 'unlisted';
  owner_identity_ref: string;
  repository_url?: string;
  repository_provider?: 'github';
  created_at: string;
  updated_at: string;
}

export interface LobbyMember {
  id: string;
  lobby_id: string;
  identity_ref: string;
  agent_registry_id?: string;
  role: 'owner' | 'admin' | 'boss' | 'contributor' | 'observer' | 'agent';
  status: 'invited' | 'active' | 'revoked';
  invited_by_identity_ref?: string;
  expires_at?: string;
}

/**
 * A model-provider API key held server-side for Hosted Mode, so a no-local-setup user can run
 * agents from the online lobby. Scoped per-lobby (`agent_ref: null` = the lobby default that all
 * its agents share) with an optional per-agent override (`agent_ref` set to the agent's DID/id).
 * The key itself is stored only as `encrypted_key` (a secret-box seal) and is NEVER returned in
 * plaintext over the API — only `key_hint` is shown. Local Mode is unaffected: it keeps local BYOK.
 */
export interface ProviderKeyConfig {
  id: string;
  lobby_id: string;
  /** null = lobby-wide default; a value = per-agent override for that agent ref. */
  agent_ref: string | null;
  /** Provider id, matching the providers registry (e.g. 'anthropic', 'openai'). */
  provider: string;
  /** secret-box sealed key material (`keyId.ciphertext.iv.tag`). Never logged or returned. */
  encrypted_key: string;
  /** Key id the value was sealed with (rotation detection). */
  encryption_key_id: string;
  /** Non-secret display hint (masked, last 4 chars). */
  key_hint: string;
  /** Optional custom endpoint + default model for this provider. */
  base_url?: string;
  model?: string;
  created_by_identity_ref: string;
  created_at: string;
  updated_at: string;
  revoked_at?: string;
}

/**
 * A single-use, short-lived wallet sign-in challenge (production Concordium account-ownership
 * proof). Bound to the account, the request origin, the network, the session, and the lobby so a
 * signature captured in one context cannot be replayed in another. Consumed on first verify attempt.
 */
export interface WalletChallenge {
  id: string;
  account: string;
  origin: string;
  network: 'mainnet' | 'testnet';
  session_id: string;
  lobby_id: string;
  /** The exact string the wallet signs. Whitespace must match verbatim between sign and verify. */
  challenge: string;
  /** Epoch ms. */
  expires_at: number;
}

export interface LobbyIntegration {
  id: string;
  lobby_id: string;
  provider: 'slack' | 'github' | 'google_drive' | 'discord' | 'telegram' | 'supabase' | 'dreambase' | WorkspaceProvider;
  status: 'pending' | 'active' | 'revoked' | 'error';
  external_account_id?: string;
  external_account_name?: string;
  scopes: string[];
  installed_by_identity_ref: string;
  created_at: string;
  updated_at: string;
  /** GitHub App installation id — used to mint short-lived installation tokens. */
  installation_id?: string;
  /** The repo the lobby's agents work on, as "owner/repo" (chosen from the installed repos). */
  repo_full_name?: string;
  /** The working branch (defaults to the repo's default branch). */
  branch?: string;
}

export interface IntegrationSecret {
  id: string;
  integration_id: string;
  secret_type: 'access_token' | 'refresh_token' | 'bot_token' | 'signing_secret' | 'installation_token';
  encrypted_value: string;
  encryption_key_id: string;
  expires_at?: string;
  rotated_at?: string;
  revoked_at?: string;
}

export interface ExternalIdentityLink {
  id: string;
  provider: 'slack';
  external_team_id: string;
  external_user_id: string;
  identity_ref: string;
  verified_at: string;
  revoked_at?: string;
}

export interface KnowledgeBase {
  id: string;
  lobby_id: string;
  repository_url: string;
  branch: string;
  kb_root_path: string;
  latest_commit_sha?: string;
  last_synced_at?: string;
  last_indexed_at?: string;
}

export interface KnowledgeSyncJob {
  id: string;
  lobby_id: string;
  kb_id: string;
  source_provider: 'upload' | 'google_drive' | 'github';
  status: 'queued' | 'running' | 'converted' | 'indexed' | 'committed' | 'failed';
  source_ref?: string;
  source_sha256?: string;
  error?: string;
  created_by_identity_ref: string;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceTask {
  id: string;
  lobby_id: string;
  title: string;
  description: string;
  proposed_budget_ccd: number;
  status: 'posted' | 'bidded' | 'assigned' | 'completed' | 'failed';
  assigned_agent_id?: string;
  assigned_agent_ref?: string;
  posted_by_identity_ref: string;
  created_at: string;
  updated_at: string;
  /** On-chain transaction hash, when an escrow contract settles the task on Concordium. */
  tx_hash?: string;
  /** Wallet signature authorizing the escrow lock at post time (off-chain authorization). */
  escrow_signature?: string;
  /** Wallet signature authorizing the escrow release at completion (off-chain authorization). */
  release_signature?: string;
}

export interface ConcordiumIssuerRecord {
  issuer_did: string;
  identity_ref: string;
  registered_at: string;
  revoked: boolean;
}

export interface TaskBid {
  id: string;
  task_id: string;
  agent_did: string;
  bidder_identity_ref: string;
  created_at: string;
}

