// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

import type { LobbyStore } from '../store.js';
import type { LobbyMessage } from '@agent-os/protocol-core';
import { getDecryptedSecret } from './githubApp.js';

/**
 * Outbound chat relay — forwards a lobby message to the owner's connected Slack / Telegram / Discord
 * channel, so the swarm's activity shows up where the team already is. Owner-connected: it uses the
 * bot token the owner sealed per-lobby and the channel id they supplied on connect. This is the
 * OUTBOUND half (lobby → channel); the inbound half (channel → lobby) needs provider webhooks and is
 * a separate step. Entirely fire-and-forget: a failed post never blocks or fails lobby messaging.
 */

const CHAT_PROVIDERS = ['slack', 'telegram', 'discord'] as const;
type ChatProvider = (typeof CHAT_PROVIDERS)[number];

/** POST one message to a single provider's channel. Returns false on any non-ok/error (logged upstream). */
async function postToProvider(provider: ChatProvider, token: string, channelId: string, text: string): Promise<boolean> {
  try {
    if (provider === 'telegram') {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: channelId, text, disable_web_page_preview: true }),
      });
      return res.ok;
    }
    if (provider === 'slack') {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel: channelId, text }),
      });
      // Slack returns 200 with { ok: false, error } on failures — treat those as not-delivered.
      const body = await res.json().catch(() => ({} as any));
      return res.ok && body?.ok !== false;
    }
    if (provider === 'discord') {
      const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bot ${token}` },
        body: JSON.stringify({ content: text }),
      });
      return res.ok;
    }
  } catch {
    return false;
  }
  return false;
}

/** Build the relayed line: "Name: content", trimmed to a safe length for chat APIs. */
export function formatRelayText(fromName: string, content: string): string {
  const name = (fromName || 'agent').trim();
  const body = (content || '').trim();
  return `${name}: ${body}`.slice(0, 3500);
}

/**
 * Relay a lobby message to every connected chat provider that has an active integration AND a target
 * channel id. Resolves the sender's display name from the roster. Best-effort and non-throwing.
 * Returns the providers actually posted to (useful for tests / observability).
 */
export async function relayLobbyMessageToChatApps(
  store: LobbyStore,
  lobbyId: string,
  message: Pick<LobbyMessage, 'from_agent_id' | 'content' | 'message_type'>,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<ChatProvider[]> {
  const delivered: ChatProvider[] = [];
  try {
    if (!message?.content) return delivered;
    // Resolve a human name for the sender; 'system' relays as "Agent OS", the owner as "Owner".
    let fromName = message.from_agent_id || 'agent';
    if (fromName === 'system') fromName = 'Agent OS';
    else if (fromName === 'LobbyOwner') fromName = 'Owner';
    else {
      const agent = await store.getAgent(lobbyId, message.from_agent_id).catch(() => null);
      if (agent?.display_name) fromName = agent.display_name;
    }
    const text = formatRelayText(fromName, message.content);

    for (const provider of CHAT_PROVIDERS) {
      const integ = await store.getIntegration(lobbyId, provider).catch(() => undefined);
      if (!integ || integ.status !== 'active') continue;
      const channelId = integ.external_account_id;
      if (!channelId) continue; // no target channel/chat id — nothing to post to
      const token = await getDecryptedSecret(lobbyId, provider, 'bot_token', store).catch(() => null);
      if (!token) continue;
      const ok = await postToProvider(provider, token, channelId, text);
      if (ok) delivered.push(provider);
      else console.warn(`[chat-relay] ${provider} post failed for lobby ${lobbyId}`);
    }
  } catch (e) {
    console.warn('[chat-relay] relay error:', (e as Error)?.message ?? e);
  }
  return delivered;
}
