#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * verify-providers — runnable functional verification for the model-provider (API fuel) layer.
 *
 * Like verify-adapters, this proves the contract with **no network and no real key**, by
 * injecting a fake `fetch` that returns canned `Response` objects:
 *
 *   1. registry surfaces both providers; validateAll() degrades unconfigured/keyless ones;
 *   2. BYOK is airtight — the key is read from the env by name, reaches the provider API in the
 *      auth header, but never appears in a redacted (lobby-bound) config; assertNoInlineSecret
 *      catches misuse;
 *   3. OpenAI-compatible complete()/stream() POST the right URL/headers/body and parse the
 *      Chat Completions response + SSE deltas;
 *   4. Anthropic-compatible complete()/stream() hoist system turns, POST the Messages API with
 *      x-api-key + anthropic-version, and parse content blocks + SSE text_delta.
 *
 * Exits non-zero on the first failed assertion so it can gate a commit / CI.
 */

import assert from 'node:assert/strict';
import type { ProviderConfig } from '@agent-os/protocol-core';
import {
  providerRegistry,
  OpenAICompatibleProvider,
  AnthropicCompatibleProvider,
  resolveApiKey,
  hasApiKey,
  redactProviderConfig,
  assertNoInlineSecret,
  loadProviderConfigsFromEnv,
  MissingApiKeyError,
} from '@agent-os/providers';

// ── Tiny test runner ──
let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}\n    ${(err as Error).message.split('\n').join('\n    ')}`);
  }
}

interface Recorded {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
}

/** A fake fetch that records the request and returns a canned Response. */
function recordingFetch(response: () => Response): { fetchFn: typeof fetch; last: () => Recorded } {
  let last: Recorded | undefined;
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    last = { url: String(url), init: (init ?? {}) as Recorded['init'] };
    return response();
  }) as unknown as typeof fetch;
  return { fetchFn, last: () => last as Recorded };
}

const json = (obj: unknown, status = 200): Response =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const sse = (text: string): Response =>
  new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });

async function main(): Promise<void> {
  console.log('verify-providers — model provider (API fuel) layer\n');

  // 1 ── Registry ──────────────────────────────────────────────────────────────
  await check('registry registers openai-compatible and anthropic-compatible', () => {
    const ids = providerRegistry.list().map((p) => p.id).sort();
    assert.deepEqual(ids, ['anthropic-compatible', 'openai-compatible']);
  });

  await check('validateAll degrades unconfigured / keyless providers (no throw)', async () => {
    const v = await providerRegistry.validateAll({});
    assert.equal(v['openai-compatible'].ok, false);
    assert.equal(v['openai-compatible'].message, 'not configured');
    // configured but no key present locally → ok:false with a BYOK message, still no throw
    const cfgs = loadProviderConfigsFromEnv({});
    const v2 = await providerRegistry.validateAll(cfgs);
    assert.equal(v2['anthropic-compatible'].ok, false);
    assert.match(v2['anthropic-compatible'].message ?? '', /BYOK key env/);
  });

  // 2 ── BYOK invariants ───────────────────────────────────────────────────────
  await check('resolveApiKey reads the key from env by name; throws when absent', () => {
    assert.equal(resolveApiKey({ apiKeyEnv: 'X_KEY' }, { X_KEY: 'secret-123' }), 'secret-123');
    assert.equal(hasApiKey({ apiKeyEnv: 'X_KEY' }, { X_KEY: 'secret-123' }), true);
    assert.equal(hasApiKey({ apiKeyEnv: 'X_KEY' }, {}), false);
    assert.throws(() => resolveApiKey({ apiKeyEnv: 'X_KEY' }, {}), MissingApiKeyError);
  });

  await check('redactProviderConfig carries only the env-var name, never a value', () => {
    const cfg: ProviderConfig = { id: 'openai-compatible', model: 'gpt-x', apiKeyEnv: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1' };
    const red = redactProviderConfig(cfg);
    assert.deepEqual(red, cfg); // structural fields only — no secret field exists by type
    assert.ok(!JSON.stringify(red).includes('sk-'));
  });

  await check('assertNoInlineSecret catches a secret smuggled into a config', () => {
    assert.doesNotThrow(() => assertNoInlineSecret({ id: 'openai-compatible', model: 'gpt-x', apiKeyEnv: 'OPENAI_API_KEY' }));
    assert.throws(() => assertNoInlineSecret({ id: 'openai-compatible', model: 'gpt-x', baseUrl: 'https://x/sk-ABCDEFGHIJKLMNOPQRSTUV' } as ProviderConfig), /BYOK violation/);
  });

  // 3 ── OpenAI-compatible ──────────────────────────────────────────────────────
  const openaiCfg: ProviderConfig = { id: 'openai-compatible', model: 'gpt-4o-mini', apiKeyEnv: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1' };
  process.env.OPENAI_API_KEY = 'sk-test-openai-LOCAL';

  await check('openai validateConfig ok when model + baseUrl + key present', async () => {
    const v = await new OpenAICompatibleProvider().validateConfig(openaiCfg);
    assert.equal(v.ok, true);
    assert.equal(v.capabilities?.toolUse, true);
  });

  await check('openai complete() POSTs chat/completions with Bearer auth and parses the reply', async () => {
    const rec = recordingFetch(() => json({ choices: [{ message: { content: 'hi there' } }], usage: { prompt_tokens: 7, completion_tokens: 2 } }));
    const p = new OpenAICompatibleProvider({ fetchFn: rec.fetchFn });
    await p.configure(openaiCfg);
    const out = await p.complete({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(out.content, 'hi there');
    assert.equal(out.usage?.inputTokens, 7);
    const req = rec.last();
    assert.equal(req.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(req.init.headers?.authorization, 'Bearer sk-test-openai-LOCAL');
    const body = JSON.parse(req.init.body!);
    assert.equal(body.model, 'gpt-4o-mini');
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }]);
  });

  await check('openai stream() parses SSE deltas then done', async () => {
    const rec = recordingFetch(() =>
      sse('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'),
    );
    const p = new OpenAICompatibleProvider({ fetchFn: rec.fetchFn });
    await p.configure(openaiCfg);
    const evts = [];
    for await (const e of p.stream({ messages: [{ role: 'user', content: 'hi' }], stream: true })) evts.push(e);
    assert.deepEqual(evts.map((e) => e.type), ['text', 'text', 'done']);
    assert.equal(evts.filter((e) => e.type === 'text').map((e) => e.content).join(''), 'Hello');
    assert.equal(JSON.parse(rec.last().init.body!).stream, true);
  });

  // 4 ── Anthropic-compatible ───────────────────────────────────────────────────
  const anthCfg: ProviderConfig = { id: 'anthropic-compatible', model: 'claude-sonnet-4-6', apiKeyEnv: 'ANTHROPIC_API_KEY', baseUrl: 'https://api.anthropic.com' };
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-LOCAL';

  await check('anthropic complete() POSTs /v1/messages, hoists system, sets headers, parses content', async () => {
    const rec = recordingFetch(() => json({ content: [{ type: 'text', text: 'answer' }], usage: { input_tokens: 9, output_tokens: 3 } }));
    const p = new AnthropicCompatibleProvider({ fetchFn: rec.fetchFn });
    await p.configure(anthCfg);
    const out = await p.complete({ messages: [{ role: 'system', content: 'be terse' }, { role: 'user', content: 'q' }] });
    assert.equal(out.content, 'answer');
    assert.equal(out.usage?.outputTokens, 3);
    const req = rec.last();
    assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(req.init.headers?.['x-api-key'], 'sk-ant-test-LOCAL');
    assert.equal(req.init.headers?.['anthropic-version'], '2023-06-01');
    const body = JSON.parse(req.init.body!);
    assert.equal(body.system, 'be terse'); // system hoisted out of messages
    assert.deepEqual(body.messages, [{ role: 'user', content: 'q' }]);
    assert.ok(typeof body.max_tokens === 'number');
  });

  await check('anthropic stream() parses content_block_delta then message_stop', async () => {
    const rec = recordingFetch(() =>
      sse(
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"par"}}\n\n' +
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"tial"}}\n\n' +
          'data: {"type":"message_stop"}\n\n',
      ),
    );
    const p = new AnthropicCompatibleProvider({ fetchFn: rec.fetchFn });
    await p.configure(anthCfg);
    const evts = [];
    for await (const e of p.stream({ messages: [{ role: 'user', content: 'hi' }], stream: true })) evts.push(e);
    assert.deepEqual(evts.map((e) => e.type), ['text', 'text', 'done']);
    assert.equal(evts.filter((e) => e.type === 'text').map((e) => e.content).join(''), 'partial');
  });

  // 5 ── BYOK end-to-end: key reaches the API, but never a lobby-bound config ────
  await check('the key flows to the provider API but not into a redacted config', async () => {
    const rec = recordingFetch(() => json({ choices: [{ message: { content: 'ok' } }] }));
    const p = new OpenAICompatibleProvider({ fetchFn: rec.fetchFn });
    await p.configure(openaiCfg);
    await p.complete({ messages: [{ role: 'user', content: 'hi' }] });
    // key DID reach the API (that's the point of fueling)…
    assert.ok(rec.last().init.headers?.authorization?.includes('sk-test-openai-LOCAL'));
    // …but the config that would cross a lobby boundary carries no secret.
    assert.ok(!JSON.stringify(redactProviderConfig(openaiCfg)).includes('sk-test-openai-LOCAL'));
  });

  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('verify-providers: all checks passed ✓');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
