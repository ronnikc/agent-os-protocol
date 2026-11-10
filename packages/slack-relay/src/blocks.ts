// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

export interface SwarmStatusParams {
  lobbyName: string;
  bossAgentName: string;
  rosterCount: number;
  latestCommit: string;
  lastSynced: string;
}

/** Render Swarm parameters into standard Slack visual Block Kit components. */
export function renderSlackBlocks(params: SwarmStatusParams): any[] {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🐝 Swarm Status: ${params.lobbyName}`,
        emoji: true
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Boss Agent:* ${params.bossAgentName}`
        },
        {
          type: 'mrkdwn',
          text: `*Active Roster:* ${params.rosterCount} agents connected`
        },
        {
          type: 'mrkdwn',
          text: `*KB Sync SHA:* \`${params.latestCommit}\``
        },
        {
          type: 'mrkdwn',
          text: `*Last Synced:* ${params.lastSynced}`
        }
      ]
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Powered by *Agent OS Protocol* — verified human & agent swarms.'
        }
      ]
    }
  ];
}
