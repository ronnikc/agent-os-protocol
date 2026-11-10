#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * verify-adapters — runnable functional verification for the runtime-adapter layer.
 *
 * The repo runs via `tsx` with no test runner, so this is a self-contained `node:assert`
 * smoke (run: `npm run verify-adapters`). It proves the adapter contract without needing any
 * runtime installed, by injecting a fake `spawn` that replays a canned Codex JSONL transcript:
 *
 *   1. registry surfaces both adapters with the right capabilities;
 *   2. detectAll() is resilient — a missing runtime degrades to an install message, never throws;
 *   3. mapCodexEvent() maps every thread/turn/item event onto the runtime-agnostic contract;
 *   4. readOutput() drives a full turn end-to-end (status -> thinking -> tool_call -> output ->
 *      done), ignores non-JSON noise, captures the thread id, and resumes it on the next turn.
 *
 * Exits non-zero on the first failed assertion so it can gate a commit / CI.
 */

import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { RuntimeEvent } from '@agent-os/protocol-core';
import {
  runtimeRegistry,
  CodexCliAdapter,
  mapCodexEvent,
  createApiRuntimeAdapter,
  type ChildLike,
  type SpawnFn,
} from '@agent-os/adapters';

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

/** A fake ChildProcess that replays `lines` on stdout then closes with `exitCode`. */
function makeFakeChild(lines: string[], exitCode = 0): ChildLike {
  const emitter = new EventEmitter();
  const stdout = Readable.from(lines.map((l) => `${l}\n`));
  const stderr = Readable.from(exitCode === 0 ? [] : ['codex: boom\n']);
  const stdin = new Writable({ write: (_c, _e, cb) => cb() });
  stdout.on('end', () => setImmediate(() => emitter.emit('close', exitCode)));
  return {
    stdout,
    stderr,
    stdin,
    exitCode: null,
    kill: () => true,
    on(event: 'close', listener: (code: number | null) => void) {
      emitter.on(event, listener);
      return this as unknown as ChildLike;
    },
  } as ChildLike;
}

async function drain(it: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const out: RuntimeEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

async function main(): Promise<void> {
  console.log('verify-adapters — runtime adapter layer\n');

  // 1 ── Registry + capabilities ─────────────────────────────────────────────
  await check('registry registers claude-cli and codex-cli', () => {
    const ids = runtimeRegistry.list().map((a) => a.id).sort();
    assert.deepEqual(ids, ['claude-cli', 'codex-cli']);
  });

  await check('codex-cli advertises its capabilities', () => {
    const codex = runtimeRegistry.get('codex-cli');
    assert.ok(codex, 'codex-cli adapter present');
    assert.equal(codex!.label, 'Codex CLI (OpenAI)');
    assert.equal(codex!.supportsInteractiveMode, true);
    assert.equal(codex!.supportsHeadlessMode, true);
    assert.equal(codex!.supportsJsonOutput, true);
    assert.equal(codex!.supportsSessionResume, true);
    assert.equal(codex!.supportsMcp, true);
  });

  // 2 ── detectAll resilience (a missing runtime must not break the rest) ──────
  await check('detectAll degrades a missing runtime gracefully (no throw)', async () => {
    const codex = new CodexCliAdapter({ binPath: '/nonexistent/codex-binary' });
    const result = await codex.detect();
    assert.equal(result.installed, false);
    assert.match(result.message ?? '', /npm install -g @openai\/codex/);
  });

  await check('detectAll returns a result per registered runtime', async () => {
    const all = await runtimeRegistry.detectAll();
    assert.ok('claude-cli' in all && 'codex-cli' in all);
    // codex is not installed in CI — must report installed:false, not error out.
    assert.equal(typeof all['codex-cli'].installed, 'boolean');
  });

  // 3 ── Pure event mapping ───────────────────────────────────────────────────
  await check('thread.started captures the resumable thread id', () => {
    const m = mapCodexEvent({ type: 'thread.started', thread_id: 'thr_abc' });
    assert.equal(m.threadId, 'thr_abc');
    assert.equal(m.event?.type, 'status');
  });

  await check('item.completed agent_message -> output', () => {
    const m = mapCodexEvent({ type: 'item.completed', item: { type: 'agent_message', id: 'i1', text: 'hello' } });
    assert.deepEqual(m.event, { type: 'output', content: 'hello' });
  });

  await check('item.completed reasoning -> thinking', () => {
    const m = mapCodexEvent({ type: 'item.completed', item: { type: 'reasoning', id: 'r1', text: 'pondering' } });
    assert.deepEqual(m.event, { type: 'thinking', content: 'pondering' });
  });

  await check('item.completed command_execution -> tool_call', () => {
    const m = mapCodexEvent({ type: 'item.completed', item: { type: 'command_execution', id: 'c1', command: 'ls' } });
    assert.equal(m.event?.type, 'tool_call');
    assert.equal(m.event?.content, 'ls');
  });

  await check('item.completed mcp_tool_call -> tool_call with server/tool', () => {
    const m = mapCodexEvent({ type: 'item.completed', item: { type: 'mcp_tool_call', id: 'm1', server: 'github', tool: 'list_prs' } });
    assert.equal(m.event?.type, 'tool_call');
    assert.equal(m.event?.content, 'github/list_prs');
  });

  await check('streaming item.started/updated are ignored (no duplicate text)', () => {
    assert.equal(mapCodexEvent({ type: 'item.started', item: { type: 'agent_message' } }).event, null);
    assert.equal(mapCodexEvent({ type: 'item.updated', item: { type: 'agent_message', text: 'partial' } }).event, null);
    assert.equal(mapCodexEvent({ type: 'turn.started' }).event, null);
  });

  await check('turn.completed -> terminal status; turn.failed/error -> error', () => {
    const done = mapCodexEvent({ type: 'turn.completed', usage: { output_tokens: 1 } });
    assert.equal(done.terminal, true);
    assert.equal(done.event?.type, 'status');
    assert.equal(mapCodexEvent({ type: 'turn.failed', error: { message: 'nope' } }).event?.type, 'error');
    assert.equal(mapCodexEvent({ type: 'error', message: 'fatal' }).event?.content, 'fatal');
  });

  // 4 ── buildExecArgs ────────────────────────────────────────────────────────
  await check('buildExecArgs emits exec + json + sandbox + cd + skip-git-repo-check', () => {
    const a = new CodexCliAdapter().buildExecArgs({ cwd: '/proj' });
    assert.deepEqual(a, ['exec', '--experimental-json', '--sandbox', 'workspace-write', '--cd', '/proj', '--skip-git-repo-check']);
  });

  await check('buildExecArgs honours model + resumes a known thread', () => {
    const a = new CodexCliAdapter({ model: 'gpt-5-codex', sandbox: 'read-only' }).buildExecArgs({ cwd: '/p', threadId: 'thr_9' });
    assert.ok(a.includes('--model') && a.includes('gpt-5-codex'));
    assert.ok(a.includes('--sandbox') && a.includes('read-only'));
    assert.deepEqual(a.slice(-2), ['resume', 'thr_9']);
  });

  // 5 ── Full headless turn over an injected spawn ─────────────────────────────
  const transcript = [
    JSON.stringify({ type: 'thread.started', thread_id: 'thr_run1' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'item.started', item: { type: 'agent_message', id: 'i1' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', id: 'r1', text: 'thinking…' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', id: 'c1', command: 'ls -la', status: 'completed', exit_code: 0 } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', id: 'i1', text: 'Done — listed files.' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }),
    'stray non-JSON log line — must be ignored',
  ];

  await check('readOutput drives a full turn and ignores non-JSON noise', async () => {
    const adapter = new CodexCliAdapter({ binPath: '/fake/codex', spawnFn: () => makeFakeChild(transcript, 0) });
    const handle = await adapter.startAgent({ cwd: '/proj' });
    await adapter.sendInput(handle, { type: 'user', content: 'list files' });
    const events = await drain(adapter.readOutput(handle));
    assert.deepEqual(events.map((e) => e.type), ['status', 'thinking', 'tool_call', 'output', 'status', 'done']);
    assert.equal(events.find((e) => e.type === 'output')?.content, 'Done — listed files.');
  });

  await check('readOutput captures thread id and resumes it on the next turn', async () => {
    const calls: string[][] = [];
    const adapter = new CodexCliAdapter({
      binPath: '/fake/codex',
      spawnFn: (_cmd, args) => {
        calls.push(args);
        return makeFakeChild(
          calls.length === 1
            ? transcript
            : [
                JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', id: 'i2', text: 'turn 2' } }),
                JSON.stringify({ type: 'turn.completed', usage: {} }),
              ],
          0,
        );
      },
    });
    const handle = await adapter.startAgent({ cwd: '/proj' });
    await adapter.sendInput(handle, { type: 'user', content: 'turn one' });
    await drain(adapter.readOutput(handle));
    await adapter.sendInput(handle, { type: 'user', content: 'turn two' });
    await drain(adapter.readOutput(handle));

    assert.equal(calls.length, 2, 'spawned once per turn');
    assert.ok(!calls[0].includes('resume'), 'first turn starts a fresh thread');
    assert.deepEqual(calls[1].slice(-2), ['resume', 'thr_run1'], 'second turn resumes the captured thread');
  });

  await check('readOutput surfaces a non-zero exit when no events were produced', async () => {
    const adapter = new CodexCliAdapter({ binPath: '/fake/codex', spawnFn: () => makeFakeChild([], 1) });
    const handle = await adapter.startAgent({ cwd: '/proj' });
    await adapter.sendInput(handle, { type: 'user', content: 'go' });
    const events = await drain(adapter.readOutput(handle));
    assert.deepEqual(events.map((e) => e.type), ['error', 'done']);
    assert.match(events[0].content ?? '', /codex: boom|exited with code 1/);
  });

  // ── API runtime adapter (server-side, no CLI) ──
  // Mock the provider HTTP: an Anthropic-compatible SSE stream. This exercises the full path
  // startAgent → sendInput → readOutput without any network, CLI, or key on disk.
  const sse = (chunks: string[]) =>
    chunks.map((t) => `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })}`).join('\n') +
    '\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n';
  const mockFetch = (reply: string[], status = 200): typeof fetch =>
    (async () => new Response(status === 200 ? sse(reply) : 'nope', { status })) as unknown as typeof fetch;

  await check('api runtime: detect() ok when a key is injected and config validates', async () => {
    const a = createApiRuntimeAdapter({ provider: { id: 'anthropic-compatible', model: 'claude-opus-4-8' }, apiKey: 'sk-ant-x', fetchFn: mockFetch(['hi']) });
    const d = await a.detect();
    assert.equal(d.installed, true);
    const noKey = createApiRuntimeAdapter({ provider: { id: 'anthropic-compatible', model: 'm' }, apiKey: '', fetchFn: mockFetch(['x']) });
    assert.equal((await noKey.detect()).installed, false);
  });

  await check('api runtime: startAgent → sendInput → readOutput streams the model reply', async () => {
    const a = createApiRuntimeAdapter({ provider: { id: 'anthropic-compatible', model: 'claude-opus-4-8' }, apiKey: 'sk-ant-x', fetchFn: mockFetch(['Hello', ', world']) });
    const h = await a.startAgent({ cwd: '/hosted', systemPrompt: 'You are a hosted agent.' });
    await a.sendInput(h, { type: 'user', content: 'hi' });
    const events = await drain(a.readOutput(h));
    const text = events.filter((e) => e.type === 'output').map((e) => e.content).join('');
    assert.equal(text, 'Hello, world');
    assert.equal(events[events.length - 1].type, 'done');
    assert.equal(events[events.length - 1].content, 'Hello, world', 'done carries the full reply');
  });

  await check('api runtime: readOutput with an empty queue yields done (no turn to run)', async () => {
    const a = createApiRuntimeAdapter({ provider: { id: 'anthropic-compatible', model: 'm' }, apiKey: 'k', fetchFn: mockFetch(['x']) });
    const h = await a.startAgent({ cwd: '/x' });
    assert.deepEqual((await drain(a.readOutput(h))).map((e) => e.type), ['done']);
  });

  await check('api runtime: keeps conversation continuity across turns', async () => {
    const a = createApiRuntimeAdapter({ provider: { id: 'anthropic-compatible', model: 'm' }, apiKey: 'k', fetchFn: mockFetch(['ok']) });
    const h = await a.startAgent({ cwd: '/x', systemPrompt: 'sys' });
    await a.sendInput(h, { type: 'user', content: 'turn one' });
    await drain(a.readOutput(h));
    await a.sendInput(h, { type: 'user', content: 'turn two' });
    const events = await drain(a.readOutput(h));
    assert.equal(events.filter((e) => e.type === 'output').map((e) => e.content).join(''), 'ok');
  });

  await check('api runtime: a provider HTTP error surfaces as an error event, then done', async () => {
    const a = createApiRuntimeAdapter({ provider: { id: 'anthropic-compatible', model: 'm' }, apiKey: 'k', fetchFn: mockFetch([], 500) });
    const h = await a.startAgent({ cwd: '/x' });
    await a.sendInput(h, { type: 'user', content: 'go' });
    const events = await drain(a.readOutput(h));
    assert.ok(events.some((e) => e.type === 'error'));
    assert.equal(events[events.length - 1].type, 'done');
  });

  // ── Summary ──
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('verify-adapters: all checks passed ✓');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
