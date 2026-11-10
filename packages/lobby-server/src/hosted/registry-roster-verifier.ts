// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { createHash } from 'node:crypto';
import { parseConcordiumRef } from '@agent-os/identity-concordium';
import { ContractAddress } from '@concordium/web-sdk';
import { tokenAddressToBase58 } from '@concordium/web-sdk/cis2';
import type { VerifyIdentityFn } from '../coordinator.js';
import type { RegistryMcpClient } from '../registry-mcp.js';

function matchesCardUri(value: unknown, cardOrigin: URL, did: string): boolean {
  if (typeof value !== 'string') return false;
  try {
    const uri = new URL(value);
    // Older cards were minted with HTTP behind the TLS proxy. Match the URI only; never fetch it.
    const sameOrigin = uri.origin === cardOrigin.origin ||
      (cardOrigin.protocol === 'https:' && uri.protocol === 'http:' && uri.host === cardOrigin.host);
    return sameOrigin && !uri.username && !uri.password && !uri.search && !uri.hash &&
      decodeURIComponent(uri.pathname) === `/agent-cards/${did}`;
  } catch {
    return false;
  }
}

export function createRegistryRosterVerifier(
  registry: Pick<RegistryMcpClient, 'callTool'>,
  publicOrigin: string,
  getCard: (did: string) => unknown,
): VerifyIdentityFn {
  const cardOrigin = new URL(publicOrigin);
  const lookups = new Map<string, { expiresAt: number; records: Promise<Record<string, unknown>[]> }>();

  return async (did) => {
    const ref = parseConcordiumRef(did);
    const card = getCard(did) as { did?: unknown; network?: unknown; ownerAddress?: unknown } | undefined;
    const checkedAt = new Date().toISOString();
    const result = { ref: ref ?? undefined, source: 'api' as const, checkedAt };
    if (!ref || card?.did !== did || card.network !== ref.network || typeof card.ownerAddress !== 'string' || !card.ownerAddress) {
      return { ...result, status: 'unverified' };
    }
    const owner = card.ownerAddress;
    const key = `${ref.network}:${owner}`;
    const now = Date.now();
    for (const [id, entry] of lookups) {
      if (entry.expiresAt <= now) lookups.delete(id);
    }
    let lookup = lookups.get(key);
    if (!lookup) {
      const records = registry.callTool('agents_by_owner', {
        network: ref.network, owner_account: owner, limit: 1000,
      }).then((response) => {
        if (!Array.isArray(response.agents)) throw new Error('registry response has no agent list');
        return response.agents as Record<string, unknown>[];
      });
      lookup = { expiresAt: now + 30_000, records };
      lookups.set(key, lookup);
    }
    try {
      const records = await lookup.records;
      const cardHash = createHash('sha256').update(JSON.stringify(card)).digest('hex');
      const match = records.find((record) => record && record.status === 'Active' &&
        record.network === ref.network && record.owner_account === owner &&
        record.metadata_hash_hex === cardHash && matchesCardUri(record.agent_uri, cardOrigin, did));
      if (!match) return { ...result, status: 'unverified' };
      const token = match.token_id;
      const validToken = typeof token === 'number' ? Number.isSafeInteger(token) && token >= 0
        : typeof token === 'string' && /^\d{1,20}$/.test(token) && BigInt(token) <= 0xffffffffffffffffn;
      let registryLinks;
      if (ref.network === 'mainnet' && validToken) {
        const bytes = Buffer.alloc(8);
        bytes.writeBigUInt64LE(BigInt(token as string | number));
        const id = bytes.toString('hex');
        const contract = ContractAddress.create(10082n, 0n);
        const badge = tokenAddressToBase58({ contract, id });
        registryLinks = {
          registration: `https://agent-registry-mcp.concordium.com/v1/badge-check/${badge}`,
          explorer: `https://ccdexplorer.io/mainnet/token/${contract.index}/${contract.subindex}/${id}`,
        };
      }
      return { ...result, ref: { ...ref, account: owner }, status: 'registry_verified', registryLinks };
    } catch {
      if (lookups.get(key) === lookup) lookups.delete(key);
      return { ...result, status: 'pending' };
    }
  };
}
