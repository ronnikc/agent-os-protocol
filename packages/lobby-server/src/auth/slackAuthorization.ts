// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

import type { LobbyStore } from '../store.js';

export interface SlackAuthorizationResult {
  authorized: boolean;
  identityRef?: string;
  reason?: string;
  role?: string;
}

/** Check if a Slack User ID is linked to a verified identity allowed in the private lobby. */
export async function verifySlackUserAuthorization(
  lobbyId: string,
  slackTeamId: string,
  slackUserId: string,
  store: LobbyStore
): Promise<SlackAuthorizationResult> {
  const link = await store.getExternalIdentityLink('slack', slackUserId);
  if (!link) {
    return {
      authorized: false,
      reason: 'Slack account is not linked to an Agent OS identity reference. Please run /swarm link to verify your identity.',
    };
  }

  // Check if link matches Team ID to prevent cross-tenant impersonation
  if (link.external_team_id !== slackTeamId) {
    return { authorized: false, reason: 'Slack workspace team mismatch' };
  }

  // Check if identity ref has access as a member in the private lobby
  const lobby = await store.getLobby(lobbyId);
  if (!lobby) {
    return { authorized: false, reason: 'lobby not found' };
  }

  const member = await store.getMember(lobbyId, link.identity_ref);

  if (lobby.visibility === 'private') {
    if (!member || member.status !== 'active') {
      return { authorized: false, reason: 'associated identity is not an active member of this private lobby' };
    }

    if (member.expires_at && new Date(member.expires_at).getTime() < Date.now()) {
      return { authorized: false, reason: 'associated identity membership has expired' };
    }
  }

  return { 
    authorized: true, 
    identityRef: link.identity_ref, 
    role: member?.role 
  };
}
