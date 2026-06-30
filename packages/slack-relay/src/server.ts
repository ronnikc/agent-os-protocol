// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

import express, { type Request, type Response } from 'express';
import { verifySlackSignature } from './verifier.js';
import { handleSlackCommand, type SlackCommandPayload } from './commands.js';
import type { LobbyStore } from '../../lobby-server/src/store.js';
import type { LobbyMessage } from '@agent-os/protocol-core';

export interface SlackRelayOptions {
  port: number;
  signingSecret: string;
  store: LobbyStore;
  lobbyId: string;
  sendMessageToLobby: (lobbyId: string, msg: LobbyMessage) => Promise<void>;
}

export function startSlackRelayServer(options: SlackRelayOptions) {
  const app = express();

  // Capture the raw body buffer for signature verification checks
  app.use(
    express.urlencoded({
      extended: true,
      verify: (req: any, _res: any, buf: Buffer) => {
        req.rawBody = buf.toString('utf8');
      }
    })
  );

  app.post('/api/v1/slack/commands', async (req: Request, res: Response) => {
    const rawBody = (req as any).rawBody || '';
    const timestamp = req.headers['x-slack-request-timestamp'] as string;
    const signature = req.headers['x-slack-signature'] as string;

    // Validate request signature against Slack's signing secret
    const isValid = verifySlackSignature(options.signingSecret, rawBody, timestamp, signature);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid Slack request signature verification' });
    }

    const payload: SlackCommandPayload = {
      command: req.body.command,
      text: req.body.text,
      user_id: req.body.user_id,
      team_id: req.body.team_id,
      channel_id: req.body.channel_id,
      response_url: req.body.response_url
    };

    try {
      const response = await handleSlackCommand(
        payload,
        options.lobbyId,
        options.store,
        options.sendMessageToLobby
      );
      return res.json(response);
    } catch (err) {
      return res.json({
        response_type: 'ephemeral',
        text: `Internal processing error: ${(err as Error).message}`
      });
    }
  });

  const server = app.listen(options.port);
  return {
    close: () => server.close()
  };
}
