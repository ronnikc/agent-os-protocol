// SPDX-License-Identifier: Apache-2.0
import { pathToFileURL } from 'node:url';

function parseChallenge(header) {
  try {
    return JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const origin = 'https://lobby.agent-os-protocol.com';
const routes = {
  health: '/health',
  'x401-challenge': '/api/v1/agent-lobby/x401/test-resource',
  'x401-proof': '/api/v1/agent-lobby/x401/test-resource/check',
  'x402-testnet': '/api/v1/agent-lobby/x402/testnet-resource',
  'x402-mainnet-gate': '/api/v1/agent-lobby/x402/test-resource',
};

export async function probePublicService(service, fetchService = fetch) {
  if (!Object.hasOwn(routes, service)) throw new Error('Choose ' + Object.keys(routes).join(', ') + '.');
  const timestamp = new Date().toISOString();
  try {
    const proofCheck = service === 'x401-proof';
    const response = await fetchService(origin + routes[service], {
      method: proofCheck ? 'POST' : 'GET', headers: proofCheck ? { 'X-Agent-OS-Proof': '1' } : {},
      redirect: 'error', credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    let revision;
    let diagnostic = 'Unexpected HTTP response';
    if (service === 'health' && response.ok) {
      const health = await response.json().catch(() => null);
      if (typeof health?.revision === 'string' && /^[a-f0-9]{40}$/.test(health.revision)) revision = health.revision;
      diagnostic = health?.ok === true ? 'Lobby reports healthy' : diagnostic;
    } else if (service === 'x401-challenge') {
      const header = response.headers.get('proof-request');
      if (response.status === 401 && header && header.length <= 16_384 && /^[\w-]+={0,2}$/.test(header)) {
        const payload = parseChallenge(header);
        const requests = payload?.credential_requirements?.digital?.requests;
        if (payload?.scheme === 'x401' && payload.version === '0.2.0' && Array.isArray(requests) &&
            requests.some(entry => entry?.protocol === 'openid4vp-v1-unsigned' &&
              entry.data?.response_type === 'vp_token' && typeof entry.data.nonce === 'string' && entry.data.nonce &&
              Array.isArray(entry.data.dcql_query?.credentials) &&
              entry.data.dcql_query.credentials.some(query => query?.id === 'agent_id' && query.format === 'dc+sd-jwt'))) {
          diagnostic = 'Public x401 v0.2.0 Agent ID challenge available';
        }
      }
      await response.body?.cancel();
    } else if (proofCheck && response.status === 200) {
      const result = await response.json().catch(() => null);
      if (result?.proofStatus === 200 && result.replayStatus === 401) {
        diagnostic = 'Synthetic proof accepted and replay rejected';
      }
    } else if (service === 'x402-mainnet-gate') {
      const body = await response.json().catch(() => null);
      if (!response.headers.has('payment-required')) {
        if (response.status === 503 && body?.error === 'The Mainnet test merchant is not enabled.') {
          diagnostic = 'Mainnet merchant disabled';
        } else if (response.status === 401) {
          diagnostic = 'Mainnet merchant requires an invitation';
        }
      }
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
    const ok = diagnostic !== 'Unexpected HTTP response' && diagnostic !== 'Testnet merchant unavailable';
    return { service, timestamp, status: response.status, revision, diagnostic, ok };
  } catch {
    return { service, timestamp, status: null, diagnostic: 'No usable probe response', ok: false };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await probePublicService(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
