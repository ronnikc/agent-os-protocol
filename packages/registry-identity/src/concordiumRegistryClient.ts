// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

export interface ConcordiumRegistryRecord {
  identityRef: string;
  publicKeyPem: string;
  status: 'verified' | 'revoked' | 'pending';
  ownerAccount: string;
}

export class ConcordiumRegistryClient {
  private mockRecords = new Map<string, ConcordiumRegistryRecord>();

  constructor() {
    // Seed default mock credential records for testing
    this.mockRecords.set('did:ccd:agent-001', {
      identityRef: 'did:ccd:agent-001',
      publicKeyPem: 'MOCK_PUBLIC_KEY_PEM_001',
      status: 'verified',
      ownerAccount: '0x1234567890abcdef'
    });
  }

  /** Lookup registry record for a specific identity reference. */
  async lookupIdentity(identityRef: string): Promise<ConcordiumRegistryRecord | null> {
    return this.mockRecords.get(identityRef) || null;
  }

  /** Seed registry records for testing. */
  seedRecord(record: ConcordiumRegistryRecord): void {
    this.mockRecords.set(record.identityRef, record);
  }
}
