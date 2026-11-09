// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Minimal MCP-over-HTTP client for the Concordium Agent Registry MCP service
 * (https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/mcp-service.html).
 *
 * Speaks the streamable-HTTP MCP transport: JSON-RPC 2.0 POSTs against the `/mcp` endpoint,
 * an `initialize` handshake that yields a session id header, and responses that arrive either
 * as plain JSON or as an SSE stream. The service holds no private keys — its builder tools
 * return sign-ready payloads ({ hex, schema_json }) that the owner's wallet signs and submits,
 * so this client is read/build-only by construction.
 */

const MCP_PROTOCOL_VERSION = '2025-03-26';

/** Normalized result of a tools/call — the JSON payload the tool produced. */
export interface RegistryToolPayload {
  [key: string]: unknown;
}

export interface RegistryToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export class RegistryMcpClient {
  private sessionId?: string;
  private initialized = false;
  private nextId = 1;

  constructor(private readonly endpoint: string) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) h['mcp-session-id'] = this.sessionId;
    return h;
  }

  private async rpc(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (!res.ok) throw new Error(`registry MCP ${method}: HTTP ${res.status}`);

    const ctype = res.headers.get('content-type') ?? '';
    let message: any;
    if (ctype.includes('text/event-stream')) {
      // SSE: take the data line carrying the JSON-RPC response for our request id.
      const text = await res.text();
      for (const line of text.split('\n')) {
        const m = line.match(/^data:\s*(.+)$/);
        if (!m) continue;
        try {
          const parsed = JSON.parse(m[1]);
          if (parsed.id === id) message = parsed;
        } catch {
          /* non-JSON keepalive lines are expected in SSE */
        }
      }
    } else {
      message = await res.json();
    }
    if (!message) throw new Error(`registry MCP ${method}: empty response`);
    if (message.error) {
      throw new Error(`registry MCP ${method}: ${message.error.message ?? JSON.stringify(message.error)}`);
    }
    return message.result;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.rpc('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'agent-os-lobby-server', version: '0.2.0' },
    });
    // Fire-and-forget per the MCP handshake; some servers respond 202 with no body.
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      });
    } catch {
      /* non-fatal */
    }
    this.initialized = true;
  }

  async listTools(): Promise<RegistryToolInfo[]> {
    await this.ensureInitialized();
    const result = await this.rpc('tools/list', {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  /**
   * Call a tool and return its JSON payload. Prefers `structuredContent`; otherwise parses the
   * first text content block as JSON, falling back to `{ text }` for plain-text tools.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<RegistryToolPayload> {
    await this.ensureInitialized();
    const result = await this.rpc('tools/call', { name, arguments: args });
    if (result?.isError) {
      const text = Array.isArray(result.content) ? result.content.map((c: any) => c?.text ?? '').join('\n') : '';
      throw new Error(`registry tool ${name} failed: ${text || 'unknown tool error'}`);
    }
    if (result?.structuredContent && typeof result.structuredContent === 'object') {
      return result.structuredContent as RegistryToolPayload;
    }
    const firstText = Array.isArray(result?.content)
      ? result.content.find((c: any) => c?.type === 'text' && typeof c.text === 'string')?.text
      : undefined;
    if (typeof firstText === 'string') {
      try {
        return JSON.parse(firstText) as RegistryToolPayload;
      } catch {
        return { text: firstText };
      }
    }
    return (result ?? {}) as RegistryToolPayload;
  }
}

/**
 * Tools the lobby proxy is willing to relay — every documented read, lookup, builder, and
 * utility tool. The admin-only builders (forced transfer, module upgrade, external-registry
 * rewiring) are deliberately excluded: the lobby is not a registry admin surface.
 */
export const REGISTRY_TOOL_ALLOWLIST = new Set<string>([
  // Discovery and search (require an Indexer behind the MCP service)
  'list_agents',
  'search_agents',
  'recent_registrations',
  'recent_transfers',
  'agent_history',
  // On-chain lookups
  'agent_by_token_address',
  'agent_by_external_reference',
  'agents_by_owner',
  'agent_of',
  'get_metadata',
  'get_agent_wallet',
  'is_active',
  'owner_of_key',
  // Transaction builders (CIS-8004) — sign-ready payloads only, never signed here
  'build_register',
  'build_revoke',
  'build_set_agent_uri',
  'build_set_metadata',
  'build_set_agent_wallet',
  'build_transfer',
  'build_update_operator',
  // Transaction builders (CIS-8)
  'build_cis8_canonical_bytes',
  'build_cis8_register',
  'build_cis8_revoke',
  'build_cis8_update_metadata',
  'set_agent_wallet_canonical_bytes',
  // Utilities
  'build_agent_card',
  'verify_agent_card',
  'token_address',
  'parse_token_address',
  'agent_registry_capabilities',
  'network_status',
  'contract_info',
]);
