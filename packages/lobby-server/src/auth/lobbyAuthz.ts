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
 * member with an owner/admin role. Returns false for unknown lobbies, unowned (legacy) lobbies, and
 * revoked members. PURE predicate — no side effects; safe to call from anywhere. To adopt an unowned
 * lobby for a wallet (the deliberate write path), use `authorizeLobbyManager`.
 */
export async function isLobbyManager(store: LobbyStore, lobbyId: string, identityRef: string): Promise<boolean> {
  if (!identityRef) return false;
  const lobby = await store.getLobby(lobbyId);
  if (!lobby) return false;
  if (lobbyOwnerRef(lobby) === identityRef) return true;
  const member = await store.getMember(lobbyId, identityRef);
  return !!member && member.status !== 'revoked' && MANAGER_ROLES.has(member.role);
}

/**
 * Authorize a wallet to manage a lobby, adopting an UNOWNED (legacy / bootstrap `system`) lobby for
 * the caller on their first management action. This is the deliberate, authenticated write path used
 * by the management HTTP endpoints — kept OUT of `isLobbyManager` so that predicate stays pure and
 * testable. Claiming an unowned lobby is first-writer-wins and safe: every later management action
 * requires proving the same wallet, so claiming a lobby you don't control only locks you out.
 */
export async function authorizeLobbyManager(store: LobbyStore, lobbyId: string, identityRef: string): Promise<boolean> {
  if (!identityRef) return false;
  const lobby = await store.getLobby(lobbyId);
  if (!lobby) return false;

  const owner = lobby.created_by;
  if (!owner || owner === 'system' || owner === 'web-user') {
    await store.updateLobby(lobbyId, { created_by: identityRef });
    await store.addMember({
      id: `mem_${randomUUID()}`,
      lobby_id: lobbyId,
      identity_ref: identityRef,
      role: 'owner',
      status: 'active',
    });
    return true;
  }
  return isLobbyManager(store, lobbyId, identityRef);
}
