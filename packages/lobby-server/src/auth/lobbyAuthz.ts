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
 * Bind an UNOWNED lobby's owner to `identityRef`. No-op (returns false) if the lobby is already
 * owned or unknown. This is the single ownership-adoption primitive, used at wallet SIGN-IN so the
 * first wallet to authenticate to a public lobby becomes its owner — after which management is
 * locked to that wallet and no later joiner can claim it. First-writer-wins and safe: claiming a
 * lobby only ever binds it to the claiming wallet.
 */
export async function claimLobbyOwnership(store: LobbyStore, lobbyId: string, identityRef: string): Promise<boolean> {
  if (!identityRef) return false;
  const lobby = await store.getLobby(lobbyId);
  if (!lobby) return false;
  const owner = lobby.created_by;
  if (owner && owner !== 'system' && owner !== 'web-user') return false; // already owned — do not reassign
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

/**
 * Authorize a wallet to manage a lobby. Ownership is normally bound at sign-in (`claimLobbyOwnership`),
 * so by the time any management action runs the lobby is already owned. As a backstop, an UNOWNED
 * lobby is still adopted for the caller here — kept OUT of `isLobbyManager` so that predicate stays
 * pure. Once owned, only the bound owner (or an active admin member) passes.
 */
export async function authorizeLobbyManager(store: LobbyStore, lobbyId: string, identityRef: string): Promise<boolean> {
  if (!identityRef) return false;
  const lobby = await store.getLobby(lobbyId);
  if (!lobby) return false;

  const owner = lobby.created_by;
  if (!owner || owner === 'system' || owner === 'web-user') {
    await claimLobbyOwnership(store, lobbyId, identityRef);
    return true;
  }
  return isLobbyManager(store, lobbyId, identityRef);
}
