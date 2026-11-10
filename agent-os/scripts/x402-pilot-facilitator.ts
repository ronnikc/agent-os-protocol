// SPDX-License-Identifier: Apache-2.0
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { ConcordiumGRPCNodeClient } from '@concordium/web-sdk/nodejs';
import { credentials } from '@grpc/grpc-js';
import { createPilotFacilitator } from '../../packages/lobby-server/src/hosted/test-merchant.js';

async function readPayment(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 32_768) throw new Error('Payment request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

function hash(value: string) {
  return createHash('sha256').update(value).digest();
}

try {
  if (!process.argv[2] || process.stdin.isTTY) throw new Error('Configuration path and piped sponsor key required');
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  if (typeof config.facilitatorToken !== 'string' || config.facilitatorToken.length < 32) {
    throw new Error('Facilitator bearer token required');
  }
  const auth = hash('Bearer ' + config.facilitatorToken);
  const node = new ConcordiumGRPCNodeClient('grpc.mainnet.concordium.software', 20000, credentials.createSsl(), { timeout: 12_000 });
  const facilitator = createPilotFacilitator(config, node, readFileSync(0, 'utf8').trim().replace(/^0x/i, ''));
  mkdirSync(config.receiptDirectory, { recursive: true, mode: 0o700 });
  await facilitator.getSupported();

  createServer(async (request, response) => {
    function reply(status: number, payload: object) {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(payload));
    }
    if (!timingSafeEqual(auth, hash(request.headers.authorization ?? ''))) {
      return reply(401, { error: 'Facilitator authorization required' });
    }
    try {
      if (request.method === 'GET' && request.url === '/supported') {
        return reply(200, await facilitator.getSupported());
      }
      if (request.method !== 'POST' || !['/verify', '/settle'].includes(request.url ?? '')) {
        return reply(404, { error: 'Unknown facilitator route' });
      }
      const body = await readPayment(request);
      if (body?.x402Version !== 2 || !body.paymentPayload || !body.paymentRequirements) {
        return reply(400, { error: 'Expected an x402 v2 payment' });
      }
      if (request.url === '/verify') {
        return reply(200, await facilitator.verify(body.paymentPayload, body.paymentRequirements));
      }
      return reply(200, await facilitator.settle(body.paymentPayload, body.paymentRequirements));
    } catch {
      return reply(502, { error: 'Pilot operation unavailable. Reconcile any settlement attempt on Mainnet.' });
    }
  }).listen(4739, '127.0.0.1', () => {
    console.log('Mainnet sponsor verified. Pilot facilitator listening on Windows loopback port 4739.');
  });
} catch {
  console.error('Pilot facilitator did not start. Check the local configuration, sponsor account, balance and attempt reservation.');
  process.exitCode = 1;
}
