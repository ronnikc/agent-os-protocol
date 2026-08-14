// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Lobby authorization — decides whether a wallet (proven via a session token) may MANAGE a lobby:
 * change its settings, and configure its Hosted-Mode provider keys. A manager is the lobby owner
 * or an admin member. This is the authz layer that sits on top of authentication (identityProof):
 * authn proves *which* wallet you are; authz decides *what* that wallet may do here.
 */

import type { LobbyStore } from '../store.js';
import type { LobbySession } from '@agent-os/protocol-core';
import { randomUUID } from 'node:crypto';

const MANAGER_ROLES = new Set(['owner', 'admin']);

/** The lobby's owner identity, if one was bound at creation (`created_by` holding a real ref). */
export function lobbyOwnerRef(lobby: Pick<LobbySession, 'created_by'> | undefined): string | null {
  const owner = lobby?.created_by;
  // 'system' / undefined / 'web-user' are the legacy unauthenticated defaults — not a real owner.
  if (!owner || owner === 'system' || owner === 'web-user') return null;
  return owner;
}

/**
 * True when `identityRef` may manage `lobbyId`: it is the bound owner (created_by) OR an active
 * member with an owner/admin role. Returns false for unknown lobbies and unowned (legacy) lobbies —
 * Hosted-Mode configuration requires an owned lobby.
 */
export async function isLobbyManager(store: LobbyStore, lobbyId: string, identityRef: string): Promise<boolean> {
  if (!identityRef) return false;
  const lobby = await store.getLobby(lobbyId);
  if (!lobby) return false;

  const member = await store.getMember(lobbyId, identityRef);
  if (member && member.status === 'revoked') return false;

  const owner = lobbyOwnerRef(lobby);
  if (owner && owner === identityRef) return true;

  return !!member && member.status !== 'revoked' && MANAGER_ROLES.has(member.role);
}
