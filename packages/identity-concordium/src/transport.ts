// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * IdentityTransport — the injectable, **read-only** seam between the verifier and a registry data
 * source. Keeping it an interface (mirroring the model-provider `fetch` seam) means the verifier's
 * rules are unit-verifiable with a fake transport — no network, no live indexer, no keys.
 *
 * The default `HttpIndexerTransport` resolves references against a Concordium Agent Registry
 * **indexer** over plain HTTP GET (the indexer is what serves the registry's read/discovery tools:
 * `list_agents`, `search_agents`, `recent_registrations`, and single-record lookup). It performs
 * **reads only** — it never signs or submits anything, and it carries no credentials.
 */

import type { ConcordiumAgentRef, RegistryAgentRecord } from '@agent-os/protocol-core';

/** Minimal `fetch` shape — lets a fake be injected for verification. */
export type FetchFn = (input: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** The read-only data source the verifier resolves references through. */
export interface IdentityTransport {
  /**
   * Resolve a single registry record for a reference. Returns `null` when the registry has no such
   * record (a definitive "not found"); **throws** when the source itself is unreachable
   * (indeterminate — the verifier maps that to `pending`, never to a false `failed`).
   */
  lookupAgent(ref: ConcordiumAgentRef): Promise<RegistryAgentRecord | null>;
  /** Optional discovery (indexer `search_agents`). */
  searchAgents?(query: string): Promise<RegistryAgentRecord[]>;
}

export interface HttpIndexerTransportOptions {
  /** Base URL of a Concordium Agent Registry indexer (read API). */
  baseUrl: string;
  /** Injected fetch (defaults to the global). */
  fetchFn?: FetchFn;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
}

/** The DID-or-id key used to address a single record on the indexer. */
function recordKey(ref: ConcordiumAgentRef): string {
  return ref.did ?? ref.agentId ?? ref.account ?? '';
}

/** Map a loosely-typed indexer JSON record onto the public `RegistryAgentRecord` view. */
function toRecord(json: Record<string, unknown>): RegistryAgentRecord {
  const did = String(json.did ?? json.id ?? '');
  return {
    did,
    account: typeof json.account === 'string' ? json.account : undefined,
    name: typeof json.name === 'string' ? json.name : undefined,
    capabilities: Array.isArray(json.capabilities) ? (json.capabilities as unknown[]).map(String) : undefined,
    // VCK — a verified human owner stands behind the agent.
    humanLinked: Boolean(json.human_linked ?? json.humanLinked ?? json.owner_verified),
    // VCDC — a verified operating domain/organization.
    domain: typeof json.domain === 'string' ? json.domain : undefined,
    revoked: Boolean(json.revoked),
    registeredAt: typeof json.registered_at === 'string' ? json.registered_at : undefined,
    issuerDid: typeof json.issuer_did === 'string' ? json.issuer_did : typeof json.issuerDid === 'string' ? json.issuerDid : undefined,
  };
}

/**
 * Read-only HTTP transport against a registry indexer. Routes follow a conventional REST shape
 * (`GET /agents/:key`, `GET /agents?q=`); point `baseUrl` at a live indexer to use it. No auth
 * header is ever attached — verification needs none, and this transport must never carry a secret.
 */
export class HttpIndexerTransport implements IdentityTransport {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;

  constructor(options: HttpIndexerTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async lookupAgent(ref: ConcordiumAgentRef): Promise<RegistryAgentRecord | null> {
    const key = recordKey(ref);
    if (!key) return null;
    const res = await this.fetchFn(`${this.baseUrl}/agents/${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`indexer lookup failed: HTTP ${res.status}`);
    return toRecord((await res.json()) as Record<string, unknown>);
  }

  async searchAgents(query: string): Promise<RegistryAgentRecord[]> {
    const res = await this.fetchFn(`${this.baseUrl}/agents?q=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`indexer search failed: HTTP ${res.status}`);
    const json = (await res.json()) as { agents?: unknown[] } | unknown[];
    const arr = Array.isArray(json) ? json : (json.agents ?? []);
    return arr.map((j) => toRecord(j as Record<string, unknown>));
  }
}

/**
 * A transport for "no indexer configured": every lookup is indeterminate (it throws), so the
 * verifier yields `pending` rather than a false `failed`. With no live source, a policy that
 * *requires* resolution therefore fails closed — the safe default.
 */
export class UnconfiguredTransport implements IdentityTransport {
  async lookupAgent(): Promise<RegistryAgentRecord | null> {
    throw new Error('no registry indexer configured (set AGENT_OS_CONCORDIUM_INDEXER_URL)');
  }
}
