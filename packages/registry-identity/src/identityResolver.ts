// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import type { ConcordiumRegistryClient } from './concordiumRegistryClient.js';

export class IdentityResolver {
  private registryClient: ConcordiumRegistryClient;

  constructor(registryClient: ConcordiumRegistryClient) {
    this.registryClient = registryClient;
  }

  /** Retrieve the verified Concordium credentials mapped to a specific identity reference. */
  async resolveIdentityRef(identityRef: string) {
    const record = await this.registryClient.lookupIdentity(identityRef);
    if (!record || record.status !== 'verified') {
      return null;
    }
    return record;
  }
}
