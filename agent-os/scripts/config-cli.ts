#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * agent-os config — configure Hosted-Mode settings from the CLI, over the lobby's REST API.
 *
 * This is the "CLI or API configuration" surface: everything here is a thin, scriptable wrapper
 * over the same wallet-gated endpoints the hosted panel uses. Authentication is a Bearer session
 * token (obtain it from the panel's wallet sign-in) passed
 * via --token or AGENT_OS_SESSION_TOKEN. The lobby base URL comes from --lobby-url or
 * AGENT_OS_LOBBY_URL. Provider API keys are sent to the lobby over TLS and stored encrypted;
 * they are never written to disk by this CLI.
 *
 * Usage:
 *   npm run config -- whoami        --lobby <id>
 *   npm run config -- list-keys     --lobby <id>
 *   npm run config -- set-key       --lobby <id> --provider anthropic --key sk-ant-... \
 *                                   [--agent <ref>] [--base-url <url>] [--model <id>]
 *   npm run config -- revoke-key    --lobby <id> --id <keyId>
 *   npm run config -- nonce         --lobby <id> --identity did:ccd:...   (dev bridge only)
 *
 * Global flags: --lobby-url <url> (or AGENT_OS_LOBBY_URL), --token <t> (or AGENT_OS_SESSION_TOKEN).
 */

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const lobbyUrl = (flag('lobby-url') || process.env.AGENT_OS_LOBBY_URL || '').replace(/\/$/, '');
const token = flag('token') || process.env.AGENT_OS_SESSION_TOKEN || '';
const lobbyId = flag('lobby') || '';

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(`agent-os config — Hosted-Mode configuration over the lobby API

Commands:
  whoami       --lobby <id>                          confirm the session token's wallet
  list-keys    --lobby <id>                          list configured provider keys (masked)
  set-key      --lobby <id> --provider <p> --key <k> [--agent <ref>] [--base-url <u>] [--model <m>]
  revoke-key   --lobby <id> --id <keyId>
  launch-agent --lobby <id> --name <n> [--role <r>] [--provider <p>] [--model <m>] [--agent <ref>] [--system <prompt>]
  list-agents  --lobby <id>                          list running hosted agents
  stop-agent   --lobby <id> --id <agentId>
  nonce        --lobby <id> --identity <ref>         get a nonce from the opt-in dev bridge

Global: --lobby-url <url> (or AGENT_OS_LOBBY_URL), --token <t> (or AGENT_OS_SESSION_TOKEN)`);
  process.exit(msg ? 1 : 0);
}

async function api(method: string, path: string, body?: unknown, auth = true): Promise<any> {
  if (!lobbyUrl) usage('set --lobby-url or AGENT_OS_LOBBY_URL');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) {
    if (!token) usage('set --token or AGENT_OS_SESSION_TOKEN (obtain it via wallet sign-in)');
    headers['authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${lobbyUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    console.error(`✗ ${res.status} ${data.error || res.statusText}`);
    process.exit(1);
  }
  return data;
}

async function main(): Promise<void> {
  if (!cmd || cmd === '--help' || cmd === '-h') usage();

  if (cmd === 'whoami') {
    if (!lobbyId) usage('--lobby is required');
    const r = await api('GET', `/api/v1/agent-lobby/lobbies/${encodeURIComponent(lobbyId)}/session`);
    console.log(`✓ signed in as ${r.identity_ref} (lobby ${r.lobby_id})`);
    return;
  }

  if (cmd === 'nonce') {
    const identity = flag('identity');
    if (!lobbyId || !identity) usage('--lobby and --identity are required');
    const r = await api('POST', '/api/v1/agent-lobby/auth/nonce', { identity_ref: identity, lobby_id: lobbyId }, false);
    console.log(`nonce: ${r.nonce}`);
    console.log(`Sign this nonce with your wallet, then POST it to /auth/verify to get a session token.`);
    return;
  }

  if (cmd === 'list-keys') {
    if (!lobbyId) usage('--lobby is required');
    const r = await api('GET', `/api/v1/agent-lobby/lobbies/${encodeURIComponent(lobbyId)}/provider-keys`);
    const keys = r.provider_keys || [];
    if (keys.length === 0) { console.log('(no provider keys configured)'); return; }
    for (const k of keys) {
      console.log(`- ${k.provider}  ${k.key_hint}  scope=${k.scope}${k.agent_ref ? ` agent=${k.agent_ref}` : ''}${k.model ? ` model=${k.model}` : ''}  id=${k.id}`);
    }
    return;
  }

  if (cmd === 'set-key') {
    const provider = flag('provider');
    const key = flag('key');
    if (!lobbyId || !provider || !key) usage('--lobby, --provider and --key are required');
    const r = await api('POST', `/api/v1/agent-lobby/lobbies/${encodeURIComponent(lobbyId)}/provider-keys`, {
      provider, api_key: key, agent_ref: flag('agent'), base_url: flag('base-url'), model: flag('model'),
    });
    const v = r.provider_key;
    console.log(`✓ ${v.scope} key set for ${v.provider} (${v.key_hint})${v.agent_ref ? ` agent=${v.agent_ref}` : ''}`);
    return;
  }

  if (cmd === 'revoke-key') {
    const id = flag('id');
    if (!lobbyId || !id) usage('--lobby and --id are required');
    await api('DELETE', `/api/v1/agent-lobby/lobbies/${encodeURIComponent(lobbyId)}/provider-keys/${encodeURIComponent(id)}`);
    console.log(`✓ revoked ${id}`);
    return;
  }

  if (cmd === 'launch-agent') {
    const name = flag('name');
    if (!lobbyId || !name) usage('--lobby and --name are required');
    const r = await api('POST', `/api/v1/agent-lobby/lobbies/${encodeURIComponent(lobbyId)}/hosted-agents`, {
      name, agent_role: flag('role'), provider: flag('provider'), model: flag('model'),
      agent_ref: flag('agent'), system_prompt: flag('system'),
    });
    console.log(`✓ launched "${r.name}" (${r.provider}/${r.model}) — agent_id=${r.agent_id}`);
    return;
  }

  if (cmd === 'list-agents') {
    if (!lobbyId) usage('--lobby is required');
    const r = await api('GET', `/api/v1/agent-lobby/lobbies/${encodeURIComponent(lobbyId)}/hosted-agents`);
    const agents = r.hosted_agents || [];
    if (agents.length === 0) { console.log('(no hosted agents running)'); return; }
    for (const a of agents) console.log(`- ${a.agent_id}`);
    return;
  }

  if (cmd === 'stop-agent') {
    const id = flag('id');
    if (!lobbyId || !id) usage('--lobby and --id are required');
    await api('DELETE', `/api/v1/agent-lobby/lobbies/${encodeURIComponent(lobbyId)}/hosted-agents/${encodeURIComponent(id)}`);
    console.log(`✓ stopped ${id}`);
    return;
  }

  usage(`unknown command "${cmd}"`);
}

main().catch((err) => { console.error(err); process.exit(1); });
