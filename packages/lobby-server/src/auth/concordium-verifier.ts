// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * Production Concordium account-ownership verification. Verifies a wallet `signMessage` signature
 * over a challenge against the account's CURRENT on-chain credential keys — never against keys
 * supplied by the client. Per Concordium's guidance, account info is fetched FRESH at verification
 * time (keys can rotate) and verification is server-side only.
 *
 * The on-chain lookup is injected (AccountInfoSource) so this is unit-testable offline with a mock
 * account and a real ed25519 signature; production uses the gRPC node client.
 */

import { AccountAddress, verifyMessageSignature } from '@concordium/web-sdk';

export type CcdNetwork = 'mainnet' | 'testnet';

/** Fresh on-chain account info for signature verification. Returns null when not found/unreachable. */
export interface AccountInfoSource {
  getAccountInfo(accountBase58: string, network: CcdNetwork): Promise<unknown | null>;
}

/** True for a syntactically valid Concordium base58 account address. */
export function isValidAccountAddress(account: string): boolean {
  try { AccountAddress.fromBase58(account); return true; } catch { return false; }
}

export function normalizeNetwork(v: unknown): CcdNetwork {
  return String(v).toLowerCase() === 'testnet' ? 'testnet' : 'mainnet';
}

/** Default public gRPC nodes; override with AGENT_OS_CONCORDIUM_NODE_MAINNET / _TESTNET (host:port). */
export function nodeEndpoint(network: CcdNetwork, env: NodeJS.ProcessEnv = process.env): { host: string; port: number } {
  const raw =
    (network === 'testnet' ? env.AGENT_OS_CONCORDIUM_NODE_TESTNET : env.AGENT_OS_CONCORDIUM_NODE_MAINNET) ||
    (network === 'testnet' ? 'grpc.testnet.concordium.com:20000' : 'grpc.mainnet.concordium.software:20000');
  const [host, portStr] = raw.replace(/^https?:\/\//, '').split(':');
  return { host, port: Number(portStr) || 20000 };
}

/**
 * gRPC-backed source. Lazily creates one client per network. `getAccountInfo` returns null on any
 * error (not found / unreachable) so the caller only ever emits a generic verification failure.
 */
export class GrpcAccountInfoSource implements AccountInfoSource {
  private clients = new Map<CcdNetwork, unknown>();

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  private async clientFor(network: CcdNetwork): Promise<{ getAccountInfo(a: unknown): Promise<unknown> }> {
    let client = this.clients.get(network) as { getAccountInfo(a: unknown): Promise<unknown> } | undefined;
    if (!client) {
      const [{ ConcordiumGRPCNodeClient }, grpc] = await Promise.all([
        import('@concordium/web-sdk/nodejs'),
        import('@grpc/grpc-js'),
      ]);
      const { host, port } = nodeEndpoint(network, this.env);
      client = new (ConcordiumGRPCNodeClient as unknown as new (h: string, p: number, c: unknown) => { getAccountInfo(a: unknown): Promise<unknown> })(
        host, port, (grpc as { credentials: { createSsl(): unknown } }).credentials.createSsl(),
      );
      this.clients.set(network, client);
    }
    return client;
  }

  async getAccountInfo(accountBase58: string, network: CcdNetwork): Promise<unknown | null> {
    try {
      const client = await this.clientFor(network);
      return await client.getAccountInfo(AccountAddress.fromBase58(accountBase58));
    } catch {
      return null;
    }
  }
}

/**
 * Verify `message` was signed by `account`'s current on-chain keys. Returns false for an invalid
 * address, an account that can't be fetched, or a bad signature. Never throws.
 */
export async function verifyAccountSignatureFresh(
  message: string,
  account: string,
  signature: unknown,
  network: CcdNetwork,
  source: AccountInfoSource,
): Promise<boolean> {
  if (!isValidAccountAddress(account)) return false;
  const info = await source.getAccountInfo(account, network);
  if (!info) return false;
  try {
    // verifyMessageSignature computes the Concordium message digest (account + message) and checks
    // the signature against the credential public keys + threshold carried in `info`.
    return await verifyMessageSignature(message, signature as never, info as never);
  } catch {
    return false;
  }
}
