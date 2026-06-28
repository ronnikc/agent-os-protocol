<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen -->

# Model Providers (API fuel)

A **model provider** fuels an agent directly via an HTTP API instead of a CLI runtime. Where a
[runtime adapter](../adapters/README.md) drives an installed CLI process, a provider speaks to an
OpenAI- or Anthropic-compatible endpoint. Both plug into the same protocol — providers implement
`ModelProviderAdapter` from [`@agent-os/protocol-core`](../../packages/protocol-core/src/model-provider.ts);
the implementations live in [`packages/providers`](../../packages/providers).

See IMPLEMENTATION-PLAN.md §5 (Phase 6) / §16 Q6 and charter §13.

## The contract

```ts
interface ModelProviderAdapter {
  id: ProviderId;                 // 'openai-compatible' | 'anthropic-compatible' | …
  label: string;
  configure(config: ProviderConfig): Promise<void>;
  complete(request): Promise<AgentCompletionResult>;       // one-shot
  stream(request): AsyncIterable<AgentCompletionEvent>;    // SSE: text | tool_call | done | error
  validateConfig(config): Promise<ProviderValidationResult>;
}

interface ProviderConfig { id; model; baseUrl?; apiKeyEnv?; }  // ← note: env-var NAME, not a key
```

## BYOK security model (the core of Phase 6)

**Keys never leave the local machine and are never sent to a lobby.** This is structural, not a
convention:

- `ProviderConfig` has **no field for a key value** — only `apiKeyEnv`, the *name* of the env var
  that holds it.
- `resolveApiKey(config)` reads the key from `process.env` at call time; it is used only to build
  the outbound request to *your* provider endpoint and is never stored, logged, or persisted.
- `redactProviderConfig(config)` returns a lobby-safe view (id, model, baseUrl, env-var name) —
  call it before any config crosses a process/network boundary.
- `assertNoInlineSecret(config)` is a defensive guard that rejects a config in which a secret was
  smuggled into another field.
- The panel's `GET /api/providers` reports only *whether* a key is present locally — never its
  value.

So a key flows **local env → provider API** directly; it does **not** flow into the swarm.

## Supported APIs

| Provider | `id` | Endpoint | Auth header | Streaming | Works with |
|---|---|---|---|---|---|
| OpenAI-compatible | `openai-compatible` | `POST {baseUrl}/chat/completions` | `Authorization: Bearer …` | SSE `choices[].delta.content` | OpenAI, OpenRouter, Together, vLLM, LM Studio, Ollama's OpenAI shim |
| Anthropic-compatible | `anthropic-compatible` | `POST {baseUrl}/v1/messages` | `x-api-key` + `anthropic-version` | SSE `content_block_delta` | Anthropic API + compatible gateways |

Capabilities are declared per provider (`validateConfig().capabilities`): tool use, function
calling, streaming, JSON mode (OpenAI), vision.

## Configure (BYOK, local)

Set the conventional env vars (see [`.env.example`](../../.env.example)); only the key is secret:

```bash
# OpenAI-compatible
OPENAI_API_KEY=sk-…                 # the only secret — stays local
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini

# Anthropic-compatible
ANTHROPIC_API_KEY=sk-ant-…
ANTHROPIC_MODEL=claude-sonnet-4-6

AGENT_OS_PROVIDER=openai-compatible  # default when an agent doesn't pin one
```

`loadProviderConfigsFromEnv()` turns these into `ProviderConfig`s; point `*_BASE_URL` at any
compatible gateway or local server to use a different backend.

## Verify

```bash
npm run verify-providers     # injected fake fetch — no network, no real key needed
```

Real smoke once a key is set locally:

```bash
node -e "import('@agent-os/providers').then(async ({OpenAICompatibleProvider})=>{const p=new OpenAICompatibleProvider();await p.configure({id:'openai-compatible',model:process.env.OPENAI_MODEL||'gpt-4o-mini',apiKeyEnv:'OPENAI_API_KEY'});console.log((await p.complete({messages:[{role:'user',content:'say hi'}]})).content);})"
```

## Add a provider

1. Add the id to `ProviderId` in `protocol-core/src/model-provider.ts` (if new).
2. Implement `packages/providers/src/<name>.ts` (reuse `readSseData` + the BYOK helpers).
3. `register()` it in `registry.ts`, export from `index.ts`, add the env convention to
   `env-config.ts`.
4. Add cases to `agent-os/scripts/verify-providers.ts` and run `npm run verify-providers`.

## Scope note

This layer ships the provider engine, BYOK config, discovery (`/api/providers`), and verification.
Binding "agent X is fueled by provider Y" into live turn execution rides on the relay driver
refactor noted in [`agent-os/STATE.md`](../../agent-os/STATE.md) follow-ups and lands next.
