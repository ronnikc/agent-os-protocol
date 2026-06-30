// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

import { randomBytes } from 'node:crypto';
import type { LobbyStore } from '../store.js';
import type { LobbyIntegration } from '../models.js';
import { saveIntegrationSecret } from './githubApp.js';

export interface SlackInstallationParams {
  lobbyId: string;
  userId: string;
  teamId: string;
  teamName: string;
  botToken: string;
  scopes: string[];
}

/** Install Slack integration for a lobby session, securely storing credentials. */
export async function installSlackIntegration(
  params: SlackInstallationParams,
  store: LobbyStore
): Promise<LobbyIntegration> {
  const existing = await store.getIntegration(params.lobbyId, 'slack');
  if (existing) {
    // Revoke old secrets/integration
    await store.updateIntegration(params.lobbyId, existing.id, { status: 'revoked' });
  }

  const integrationId = randomBytes(16).toString('hex');
  const integration: LobbyIntegration = {
    id: integrationId,
    lobby_id: params.lobbyId,
    provider: 'slack',
    status: 'active',
    external_account_id: params.teamId,
    external_account_name: params.teamName,
    scopes: params.scopes,
    installed_by_identity_ref: params.userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  await store.addIntegration(integration);
  
  // Securely encrypt and store the Bot token
  await saveIntegrationSecret(integrationId, 'bot_token', params.botToken, store);

  return integration;
}
