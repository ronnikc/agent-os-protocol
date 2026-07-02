// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

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

export interface LobbyIntegration {
  id: string;
  lobby_id: string;
  provider: 'slack' | 'github' | 'google_drive';
  status: 'pending' | 'active' | 'revoked' | 'error';
  external_account_id?: string;
  external_account_name?: string;
  scopes: string[];
  installed_by_identity_ref: string;
  created_at: string;
  updated_at: string;
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

