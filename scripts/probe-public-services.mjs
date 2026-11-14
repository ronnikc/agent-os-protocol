// SPDX-License-Identifier: Apache-2.0
import { pathToFileURL } from 'node:url';

const origin = 'https://lobby.agent-os-protocol.com';
const routes = {
  health: '/health',
  'x402-testnet': '/api/v1/agent-lobby/x402/testnet-resource',
};

export async function probePublicService(service, fetchService = fetch) {
  if (!Object.hasOwn(routes, service)) throw new Error('Choose health or x402-testnet.');
  const timestamp = new Date().toISOString();
  try {
    const response = await fetchService(origin + routes[service], {
      method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    let revision;
    let diagnostic = 'Unexpected HTTP response';
    if (service === 'health' && response.ok) {
      const health = await response.json().catch(() => null);
      if (typeof health?.revision === 'string' && /^[a-f0-9]{40}$/.test(health.revision)) revision = health.revision;
      diagnostic = health?.ok === true ? 'Lobby reports healthy' : diagnostic;
    } else {
      if (service === 'x402-testnet' && response.status === 402 && response.headers.has('payment-required')) {
        diagnostic = 'Testnet quote available';
        await response.body?.cancel();
      } else if (service === 'x402-testnet' && response.status === 503) {
        const body = await response.json().catch(() => null);
        diagnostic = body?.error === 'The Testnet merchant is not configured by this deployer.'
          ? 'Testnet merchant is unconfigured' : 'Testnet merchant unavailable';
      } else {
        await response.body?.cancel();
      }
    }
    return { service, timestamp, status: response.status, revision, diagnostic };
  } catch {
    return { service, timestamp, status: null, diagnostic: 'No usable probe response' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await probePublicService(process.argv[2]), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
