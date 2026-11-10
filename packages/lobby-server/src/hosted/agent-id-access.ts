// SPDX-License-Identifier: Apache-2.0
import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { accessAgentIdResource } from '@agent-os/concordium-commerce';

interface HostedProofConfig {
  lobbyId: string;
  did: string;
  resource: string;
  credential: string;
  holderPrivateKeyPem: string;
}

function readConfig(file: string): HostedProofConfig {
  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (!config || typeof config.lobbyId !== 'string' || typeof config.did !== 'string' ||
      typeof config.resource !== 'string' || typeof config.credential !== 'string' ||
      typeof config.holderPrivateKeyPem !== 'string') {
    throw new Error('Invalid hosted Agent ID proof configuration');
  }
  return config;
}

/** Scope operator custody to a single lobby, DID and HTTPS resource. */
export function loadHostedAgentIdAccess(options: {
  file?: string;
  lobbyId: string;
  did?: string;
  isRegistered: () => Promise<boolean>;
  fetchResource?: typeof fetch;
}): (() => Promise<string>) | undefined {
  const { file, lobbyId, did } = options;
  if (!file || !did?.startsWith('did:ccd:mainnet:agent-')) return;
  let initial: HostedProofConfig;
  try {
    initial = readConfig(file);
  } catch {
    console.warn('[lobby-server] Hosted Agent ID proof configuration is unavailable');
    return;
  }
  if (initial.lobbyId !== lobbyId || initial.did !== did) return;
  const resource = initial.resource;

  return async () => {
    try {
      if (!await options.isRegistered()) return 'Agent ID proof requires an active, verified lobby registration.';
      const config = readConfig(file);
      if (config.lobbyId !== lobbyId || config.did !== did || config.resource !== resource) {
        return 'Agent ID proof configuration changed. Restart the agent to reload it.';
      }
      const status = await accessAgentIdResource({
        did, resource, credential: config.credential, holderKey: createPrivateKey(config.holderPrivateKeyPem),
      }, options.fetchResource);
      return status >= 200 && status < 300
        ? 'Agent ID proof accepted by the configured resource.'
        : 'The configured resource returned HTTP ' + status + ' after Agent ID proof presentation.';
    } catch {
      return 'Agent ID proof access failed. Check the configured credential, verifier and expiry.';
    }
  };
}
