// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

import { createHash, timingSafeEqual } from 'node:crypto';
import type { LobbySession } from '@agent-os/protocol-core';
import type { LobbyStore } from '../store.js';
import { issueSessionToken, liveTestAdminConfig, testAdminKeyDigest, TEST_ADMIN_IDENTITY, TEST_ADMIN_LOBBY_ID } from './identityProof.js';

export async function signInTestAdmin(store: LobbyStore, key: unknown) {
  const live = liveTestAdminConfig();
  const digest = live?.digest ?? testAdminKeyDigest();
  if (!digest) return { status: 404 } as const;
  if (typeof key !== 'string' || key.length < 32 || key.length > 256 ||
      !timingSafeEqual(createHash('sha256').update(key).digest(), Buffer.from(digest, 'hex'))) {
    return { status: 401 } as const;
  }

  let lobby = await store.getLobby(live?.lobbyId ?? TEST_ADMIN_LOBBY_ID);
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
  } as const;
}
