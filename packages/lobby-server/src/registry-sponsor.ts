// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Thin proxy client for the Concordium Agent Registry **sponsor service**
 * (default https://registry-sponsor-service.concordium.com/sponsor).
 *
 * The sponsor service lets an Agent-ID mint be **gasless**: the owner's wallet builds an unsigned
 * account transaction, the sponsor co-signs it (attaching the signature of the account that pays
 * the energy), and the returned partially-signed `Transaction.JSON` is completed by the owner's
 * wallet and submitted. Concordium — not the owner — foots the fee.
 *
 * Contract (from the service's own OpenAPI, `/docs/json`):
 *   POST /sponsor
 *     request  { genesisHash: string, payload: object (unsigned Transaction.JSON),
 *                sender: string (base58 account), nonce: integer > 0 }
 *     response 200 → partially-signed Transaction.JSON with the sponsor signature attached
 *
 * No private keys ever touch this process: it only relays the unsigned payload the wallet built and
 * returns the sponsor's co-signature. This keeps the lobby "build/relay-only", the same posture as
 * the read-only MCP registry client.
 */

export const DEFAULT_SPONSOR_URL = 'https://registry-sponsor-service.concordium.com/sponsor';

export interface SponsorRequest {
  /** Genesis block hash identifying the chain (mainnet/testnet). */
  genesisHash: string;
  /** The unsigned account transaction as Transaction.JSON (as the wallet SDK serializes it). */
  payload: Record<string, unknown>;
  /** Base58 account address that will complete and submit the transaction. */
  sender: string;
  /** Account nonce for `sender` (strictly positive). */
  nonce: number;
}

export class RegistrySponsorClient {
  constructor(private readonly endpoint: string = DEFAULT_SPONSOR_URL) {}

  get url(): string {
    return this.endpoint;
  }

  /**
   * Relay an unsigned transaction to the sponsor service and return the partially-signed
   * Transaction.JSON. Throws with the upstream status/body on any non-2xx response so the caller
   * can surface a precise reason (and fall back to a self-paid submission).
   */
  async sponsor(request: SponsorRequest): Promise<Record<string, unknown>> {
    const { genesisHash, payload, sender, nonce } = request;
    if (typeof genesisHash !== 'string' || genesisHash.length === 0) {
      throw new Error('sponsor: genesisHash is required');
    }
    if (!payload || typeof payload !== 'object') {
      throw new Error('sponsor: payload (unsigned Transaction.JSON) is required');
    }
    if (typeof sender !== 'string' || sender.length === 0) {
      throw new Error('sponsor: sender (base58 account) is required');
    }
    if (!Number.isInteger(nonce) || nonce <= 0) {
      throw new Error('sponsor: nonce must be a positive integer');
    }

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ genesisHash, payload, sender, nonce }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`sponsor service HTTP ${res.status}: ${text.slice(0, 500) || '(empty body)'}`);
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`sponsor service returned non-JSON response: ${text.slice(0, 200)}`);
    }
  }
}
