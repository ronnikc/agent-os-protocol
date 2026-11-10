// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { createHash, timingSafeEqual } from 'node:crypto';
import type { LobbySession } from '@agent-os/protocol-core';
import type { LobbyStore } from '../store.js';
import { issueSessionToken, liveTestAdminConfig, testAdminKeyDigest, TEST_ADMIN_IDENTITY, TEST_ADMIN_LOBBY_ID } from './identityProof.js';

export async function signInTestAdmin(store: LobbyStore, key: unknown, requestedLobbyId?: string) {
  const live = liveTestAdminConfig();
  const digest = live?.digest ?? testAdminKeyDigest();
  if (!digest) return { status: 404 } as const;
  if (typeof key !== 'string' || key.length < 32 || key.length > 256 ||
      !timingSafeEqual(createHash('sha256').update(key).digest(), Buffer.from(digest, 'hex'))) {
    return { status: 401 } as const;
  }

  const lobbyId = live?.lobbyId === 'all'
    ? requestedLobbyId ?? (await store.listLobbies()).find(lobby => lobby.status === 'active' && lobby.visibility === 'public')?.lobby_id
    : live?.lobbyId ?? TEST_ADMIN_LOBBY_ID;
  if (!lobbyId) return { status: 404 } as const;
  if (requestedLobbyId && requestedLobbyId !== lobbyId) return { status: 403 } as const;
  let lobby = await store.getLobby(lobbyId);
  if (live && !lobby) return { status: 404 } as const;
  if (!lobby) {
    const now = new Date().toISOString();
    const testLobby: LobbySession = {
      lobby_id: TEST_ADMIN_LOBBY_ID,
      org_id: 'test',
      name: 'Admin Test Lobby',
      status: 'active',
      visibility: 'private',
      join_policy: 'allowlisted',
      created_by: TEST_ADMIN_IDENTITY,
      connected_agent_ids: [],
      message_seq: 0,
      created_at: now,
      updated_at: now,
    };
    lobby = await store.createLobby(testLobby, false);
  }
  if (!live && (lobby.created_by !== TEST_ADMIN_IDENTITY || lobby.visibility !== 'private')) return { status: 409 } as const;

  return {
    status: 200,
    lobby,
    identity_ref: TEST_ADMIN_IDENTITY,
    token: issueSessionToken(TEST_ADMIN_IDENTITY, lobby.lobby_id),
    ...(live?.lobbyId === 'all'
      ? { lobbies: (await store.listLobbies()).map(({ lobby_id, name, visibility }) => ({ lobby_id, name, visibility })) }
      : {}),
  } as const;
}
