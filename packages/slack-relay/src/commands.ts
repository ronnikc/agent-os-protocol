// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

import type { LobbyStore } from '../../lobby-server/src/store.js';
import { verifySlackUserAuthorization } from '../../lobby-server/src/auth/slackAuthorization.js';
import type { LobbyMessage } from '@agent-os/protocol-core';
import { renderSlackBlocks } from './blocks.js';

export interface SlackCommandPayload {
  command: string;
  text: string;
  user_id: string;
  team_id: string;
  channel_id: string;
  response_url: string;
}

export interface SlackResponse {
  response_type: 'in_channel' | 'ephemeral';
  text: string;
  blocks?: any[];
}

/** Process an incoming Slack slash command, enforcing Concordium authorization and floor control. */
export async function handleSlackCommand(
  payload: SlackCommandPayload,
  lobbyId: string,
  store: LobbyStore,
  sendMessageToLobby: (lobbyId: string, msg: LobbyMessage) => Promise<void>
): Promise<SlackResponse> {
  const { command, text, user_id, team_id } = payload;

  // Handle `/swarm link` command (does not require lobby permissions first, it is the setup flow)
  if (command === '/swarm' && text.startsWith('link')) {
    const parts = text.split(/\s+/);
    const identityRef = parts[1];
    if (!identityRef) {
      return {
        response_type: 'ephemeral',
        text: 'Usage: `/swarm link did:ccd:<address>`'
      };
    }

    // Set up a mock link in the local store
    await store.linkExternalIdentity({
      id: `link_${user_id}`,
      provider: 'slack',
      external_team_id: team_id,
      external_user_id: user_id,
      identity_ref: identityRef,
      verified_at: new Date().toISOString()
    });

    return {
      response_type: 'ephemeral',
      text: `Successfully linked Slack account <@${user_id}> to Agent OS identity reference \`${identityRef}\`.`
    };
  }

  const lobby = await store.getLobby(lobbyId);
  if (!lobby) {
    return {
      response_type: 'ephemeral',
      text: 'Lobby not found.'
    };
  }

  // Enforce Concordium authorization check: status in public lobbies is allowed unlinked, other commands require verification.
  let auth: any = null;
  if (lobby.visibility === 'private' || !text.startsWith('status')) {
    const authResult = await verifySlackUserAuthorization(lobbyId, team_id, user_id, store);
    if (!authResult.authorized) {
      return {
        response_type: 'ephemeral',
        text: authResult.reason || 'Unauthorized'
      };
    }
    auth = authResult;
  }

  if (command === '/swarm' && text.startsWith('task')) {
    const taskSpec = text.replace(/^task\s+/, '').trim();
    if (!taskSpec) {
      return {
        response_type: 'ephemeral',
        text: 'Usage: `/swarm task <describe what the swarm should do>`'
      };
    }

    // Role-based permission check in private lobbies
    if (lobby.visibility === 'private' && auth) {
      if (auth.role !== 'admin' && auth.role !== 'owner' && auth.role !== 'boss_agent') {
        return {
          response_type: 'ephemeral',
          text: 'Insufficient role permissions. Creating tasks from Slack in a private lobby requires an admin, owner, or boss role.'
        };
      }
    }

    // Format the command request as a floor-controlled Lobby Message to the Boss Agent.
    // The Slack Relay routes it through the Boss Agent instead of bypassing floor control.
    const seq = await store.nextSeq(lobbyId);
    const message: LobbyMessage = {
      message_id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      seq,
      from_agent_id: `slack_${user_id}`,
      to_agent_id: 'all',
      message_type: 'chat',
      content: taskSpec,
      created_at: new Date().toISOString(),
      delivered: true
    };

    // Forward to Lobby Coordinator for floor routing
    await sendMessageToLobby(lobbyId, message);

    return {
      response_type: 'in_channel',
      text: `Slack command received. Queuing task spec to Boss Agent:\n> \`${taskSpec}\``
    };
  }

  if (command === '/swarm' && text.startsWith('status')) {
    const lobby = await store.getLobby(lobbyId);
    const roster = await store.roster(lobbyId);
    const kb = await store.getKnowledgeBase(lobbyId);

    const activeBoss = roster.find((a) => a.role === 'boss_agent');

    const blocks = renderSlackBlocks({
      lobbyName: lobby?.name || 'Swarm Lobby',
      bossAgentName: activeBoss?.display_name || 'Unassigned',
      rosterCount: roster.length,
      latestCommit: kb?.latest_commit_sha || 'none',
      lastSynced: kb?.last_synced_at || 'never'
    });

    return {
      response_type: 'in_channel',
      text: `Swarm Status for Lobby ${lobbyId}`,
      blocks
    };
  }

  return {
    response_type: 'ephemeral',
    text: 'Unknown command. Available commands: `/swarm link`, `/swarm task <spec>`, `/swarm status`'
  };
}
