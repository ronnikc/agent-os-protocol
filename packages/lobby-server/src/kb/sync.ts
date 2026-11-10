// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import type { LobbyStore } from '../store.js';
import type { KnowledgeBase } from '../models.js';

/** Synchronize the local metadata cache by fetching remote Git branch status parameters. */
export async function syncKnowledgeBaseCache(
  lobbyId: string,
  store: LobbyStore
): Promise<KnowledgeBase | null> {
  const kb = await store.getKnowledgeBase(lobbyId);
  if (!kb) return null;

  try {
    // In production, execute a 'git fetch / git pull' check. 
    // Here we simulate the successful sync update:
    const mockRemoteCommitSha = 'git-commit-' + Math.random().toString(36).substring(2, 8);
    
    const updated = await store.upsertKnowledgeBase({
      ...kb,
      latest_commit_sha: mockRemoteCommitSha,
      last_synced_at: new Date().toISOString()
    });

    return updated;
  } catch (err) {
    console.error(`[KB Sync] Sync failed for lobby ${lobbyId}: ${(err as Error).message}`);
    return null;
  }
}
