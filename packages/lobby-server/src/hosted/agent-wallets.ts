// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { AccountAddress } from '@concordium/web-sdk';
import { SpendingLedger, readMainnetWalletBinding, spendingScope } from '@agent-os/concordium-commerce';
import type { IdentityVerificationResult } from '@agent-os/protocol-core';
import type { LobbyStore } from '../store.js';
import { nodeEndpoint } from '../auth/concordium-verifier.js';
import { HostedControlError } from './hosted-controls.js';

export interface AgentWalletRecord {
  owner: string;
  did: string;
  network: 'mainnet';
  address: string;
  nonce: string;
  status: 'linked' | 'paused' | 'unlinked';
  updatedAt: number;
}

export type ReadFinalWallet = (tokenId: bigint) => Promise<{ address: string | null; nonce: string; balance: string | null }>;

export function mainnetWalletReader(): ReadFinalWallet {
  let node: Promise<import('@concordium/web-sdk/nodejs').ConcordiumGRPCNodeClient> | undefined;
  return async tokenId => {
    const client = await (node ??= Promise.all([import('@concordium/web-sdk/nodejs'), import('@grpc/grpc-js')])
      .then(([{ ConcordiumGRPCNodeClient }, grpc]) => {
        const { host, port } = nodeEndpoint('mainnet');
        return new ConcordiumGRPCNodeClient(host, port, grpc.credentials.createSsl(), { timeout: 10_000 });
      }));
    const binding = await readMainnetWalletBinding(client, tokenId);
    const info = binding.wallet && await client.getAccountInfo(binding.wallet, (await client.getConsensusStatus()).lastFinalizedBlock);
    return { address: binding.wallet?.address ?? null, nonce: String(binding.nonce),
      balance: info ? String(info.accountAmount.microCcdAmount) : null };
  };
}

export class AgentWallets {
  constructor(private readonly store: LobbyStore, private readonly verify: (did: string) => Promise<IdentityVerificationResult>,
    private readonly read: ReadFinalWallet, private readonly ledger?: SpendingLedger) {}

  private async finalized(actor: string, did: string) {
    const verification = await this.verify(did);
    if (!['registry_verified', 'human_linked', 'org_linked'].includes(verification.status) || verification.ref?.network !== 'mainnet' ||
        !verification.ref.account || actor !== `did:ccd:mainnet:${verification.ref.account}` ||
        !/^\d{1,20}$/.test(verification.registryTokenId ?? '')) {
      throw new HostedControlError('Finalized mainnet agent ownership is required.', 403);
    }
    return this.read(BigInt(verification.registryTokenId!));
  }

  async view(lobbyId: string, actor: string, did: string) {
    const binding = await this.finalized(actor, did);
    const saved = this.store.readHostedState(lobbyId).wallets?.find(entry => entry.did === did && entry.owner === actor);
    return { saved, binding, eligible: saved?.status === 'linked' && saved.address === binding.address && saved.nonce === binding.nonce,
      paymentState: 'disabled' as const };
  }

  async update(lobbyId: string, actor: string, did: string, body: Record<string, unknown>) {
    const { action, nonce, address } = body;
    if (body.network !== 'mainnet') throw new HostedControlError('Select the supported wallet network.', 400);
    if (action !== 'link' && action !== 'rotate' && action !== 'pause' && action !== 'unlink') {
      throw new HostedControlError('Choose a wallet action.', 400);
    }
    const binding = await this.finalized(actor, did);
    if (nonce !== binding.nonce || address !== binding.address) throw new HostedControlError('Finalized wallet changed. Refresh and review it.');
    const enabling = action === 'link' || action === 'rotate';
    if (enabling && (!binding.address || spendingScope('mainnet', binding.address, 'CCD') === spendingScope('mainnet', actor.split(':').at(-1)!, 'CCD'))) {
      throw new HostedControlError('A distinct, finalized dedicated wallet is required.');
    }
    return this.store.mutateHostedState(lobbyId, state => {
      const entries = state.wallets ??= [];
      const current = entries.find(entry => entry.did === did);
      if (current && current.owner !== actor && (action !== 'link' || BigInt(binding.nonce) <= BigInt(current.nonce))) {
        throw new HostedControlError('The existing wallet belongs to another binding generation.', 403);
      }
      if (!current && !enabling) throw new HostedControlError('Link a dedicated wallet first.');
      if (action === 'rotate' && (!current || current.status !== 'paused' || BigInt(binding.nonce) <= BigInt(current.nonce) ||
          binding.address === current.address)) throw new HostedControlError('Pause the current wallet and finalize a distinct replacement first.');
      if (action === 'link' && current && current.status !== 'unlinked' && current.owner === actor) {
        throw new HostedControlError('This wallet is already linked. Use rotation for a replacement.');
      }
      const record: AgentWalletRecord = { owner: actor, did, network: 'mainnet', address: enabling ? binding.address! : current!.address,
        nonce: enabling ? binding.nonce : current!.nonce, status: enabling ? 'linked' : action === 'pause' ? 'paused' : 'unlinked', updatedAt: Date.now() };
      if (current) entries.splice(entries.indexOf(current), 1, record);
      else entries.push(record);
      state.audit.push({ at: record.updatedAt, actor, action: `agent_wallet_${action}`, subject: did });
      return record;
    });
  }

  async receipts(lobbyId: string, actor: string, did: string, asset: string, offset: number, limit: number) {
    await this.finalized(actor, did);
    const saved = this.store.readHostedState(lobbyId).wallets?.find(entry => entry.did === did && entry.owner === actor);
    if (!saved || !this.ledger) return { data: [], total: 0, offset, limit };
    return this.ledger.receipts(spendingScope(saved.network, AccountAddress.fromBase58(saved.address).address, asset), offset, limit);
  }
}
