// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import type { WorkspaceProvider } from '@agent-os/protocol-core';

type VerifyAccount = (credential: string, signal: AbortSignal) => Promise<void>;

/** Read-only control-plane requests with fixed hosts and no credential-bearing redirects. */
export function workspaceAccountVerifier(provider: WorkspaceProvider, fetchFn: typeof fetch = fetch): VerifyAccount | undefined {
  if (provider !== 'e2b' && provider !== 'agent37') return undefined;
  return async (credential, signal) => {
    const e2b = provider === 'e2b';
    const response = await fetchFn(
      e2b ? 'https://api.e2b.app/v2/sandboxes?limit=1' : 'https://api.agent37.com/v1/instances',
      {
        method: 'GET',
        headers: e2b ? { 'X-API-Key': credential } : { Authorization: 'Bearer ' + credential },
        redirect: 'error',
        signal,
      },
    );
    await response.body?.cancel();
    if (!response.ok) throw new Error('Provider rejected the account verification request.');
  };
}
