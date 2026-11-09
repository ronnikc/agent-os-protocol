// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

import type { LobbyStore } from '../store.js';
import { validateSessionToken } from './identityProof.js';
import { lobbyOwnerRef } from './lobbyAuthz.js';

export interface JoinPolicyResult {
  allowed: boolean;
  identityRef?: string;
  reason?: string;
}

/** Check whether an identity ref is allowed to join a specific lobby. */
export async function verifyLobbyJoinPolicy(
  lobbyId: string,
  token: string | undefined,
  store: LobbyStore,
  agentRef?: string
): Promise<JoinPolicyResult> {
  const lobby = await store.getLobby(lobbyId);
  if (!lobby) {
    return { allowed: false, reason: 'lobby not found' };
  }

  // Public lobbies do not require verification or tokens by default
  if (lobby.visibility !== 'private') {
    return { allowed: true };
  }

  const policy = lobby.join_policy || (lobby.visibility === 'private' ? 'allowlisted' : 'none');

  // Private lobbies require a valid token
  if (!token) {
    return { allowed: false, reason: 'authentication token is required' };
  }

  const payload = validateSessionToken(token, lobbyId);
  if (!payload) {
    return { allowed: false, reason: 'invalid or expired session token' };
  }

  // Verify membership record in database
  const identityRef = agentRef ?? payload.identityRef;
  const member = await store.getMember(lobbyId, identityRef);
  if (policy === 'allowlisted' && identityRef !== lobbyOwnerRef(lobby) &&
      !(lobby.allowlist ?? []).includes(identityRef)) {
    return { allowed: false, reason: 'private lobby: not on the allowlist' };
  }
  if (policy === 'allowlisted' && !member) {
    return { allowed: true, identityRef };
  }
  if (!member) {
    return { allowed: false, reason: 'not a member of this private lobby' };
  }

  if (member.status !== 'active') {
    return { allowed: false, reason: 'membership has been revoked or is pending' };
  }

  if (member.expires_at && new Date(member.expires_at).getTime() < Date.now()) {
    return { allowed: false, reason: 'membership has expired' };
  }

  return { allowed: true, identityRef };
}
