<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen -->

# Runtime Adapters

Agent OS Protocol is **runtime-agnostic**: the relay, lobby, and panel speak one stable internal
protocol, and every agent runtime (a CLI today, an API in Phase 6) plugs in as a swappable
**adapter**. Nothing is hardwired to a single runtime. See
[`../../IMPLEMENTATION-PLAN.md`](../../IMPLEMENTATION-PLAN.md) §4 / §8 for the architecture and
charter §12 for the contract.

## The contract

Every adapter implements `AgentRuntimeAdapter` from
[`@agent-os/protocol-core`](../../packages/protocol-core/src/runtime-adapter.ts):

```ts
interface AgentRuntimeAdapter {
  id: RuntimeId;                 // 'claude-cli' | 'codex-cli' | 'opencode' | 'cursor' | ...
  label: string;                 // human-readable name shown in the panel
  detect(): Promise<RuntimeDetectionResult>;            // installed? version? how to install?
  startAgent(config): Promise<AgentProcessHandle>;      // open a session
  stopAgent(handle): Promise<void>;
  sendInput(handle, message): Promise<void>;            // queue a turn
  readOutput(handle): AsyncIterable<RuntimeEvent>;      // stream one turn's events
  supportsInteractiveMode / supportsHeadlessMode / supportsJsonOutput
    / supportsSessionResume / supportsMcp;
}
```

`RuntimeEvent` is the runtime-neutral event surfaced to the relay/UI:
`output | thinking | tool_call | status | done | error`. Each adapter's job is to translate its
runtime's native output into this vocabulary.

### Design rules (charter §12)

- **Feature-flagged.** A missing runtime is *reported*, not fatal — `detect()` returns
  `{ installed: false, message }` with install guidance; the panel shows it as unavailable.
- **Isolated failure.** One adapter throwing never breaks the others —
  [`AdapterRegistry.detectAll()`](../../packages/adapters/src/registry.ts) wraps each `detect()`.
- **Detected, never bundled.** Adapters drive the user's *globally installed* runtime (resolved on
  `PATH`); they do not vendor a CLI. (The Claude adapter embeds the Claude Agent SDK only because
  Claude ships a first-class in-process Node driver; Codex and the rest are spawned binaries.)
- **Stable protocol.** Adding an adapter never changes the relay/lobby protocol.

## Registering an adapter

1. Add the runtime id to `RuntimeId` in `protocol-core/src/runtime-adapter.ts` (if new).
2. Implement `packages/adapters/src/<runtime>.ts`.
3. `register()` it in `packages/adapters/src/registry.ts` and `export *` it from `index.ts`.
4. Add cases to `agent-os/scripts/verify-adapters.ts` and run `npm run verify-adapters`.
5. Write a discovery spike under `docs/adapters/<runtime>.md` and update the matrix below.

The panel's `GET /api/runtimes` then surfaces it automatically via `runtimeRegistry.detectAll()`.

## Compatibility matrix

Status legend: ✅ adapter shipped · 🔜 next spike · ⚠️ blocked (see notes) · ⬜ not yet spiked.
Capability cells for runtimes without a shipped adapter are **provisional** until confirmed in a
live discovery spike (charter §8).

| Runtime | Status | Install / Auth | Interactive | Headless | JSON stream | Resume | MCP | Spike |
|---|---|---|---|---|---|---|---|---|
| **Claude CLI** | ✅ Phase 4 | `npm i -g @anthropic-ai/claude-code`; `claude login` | ✅ | ✅ | ✅ | ✅ | ✅ | (relay/SDK) |
| **Codex CLI** | ✅ Phase 5 | `npm i -g @openai/codex`; ChatGPT login / `OPENAI_API_KEY` | ✅ | ✅ `codex exec` | ✅ `--experimental-json` (JSONL) | ✅ `resume <id>` | ✅ | [codex-cli.md](codex-cli.md) |
| **OpenCode** | 🔜 next | `npm i -g opencode-ai` / curl | ✅ | ✅ `opencode run` | ✅ `--format json` / ACP nd-JSON | ✅ sessions | ✅ | [runtime-spikes.md](runtime-spikes.md#opencode) |
| **Cursor CLI** | ⚠️ TTY | `cursor login` | ✅ | ✅ `cursor-agent -p` | ✅ `--output-format json\|stream-json` | ✅ `--resume` | ✅ | [runtime-spikes.md](runtime-spikes.md#cursor-cli) |
| **Hermes** | ⬜ | _to confirm_ | ? | ? | ? | ? | ? | [runtime-spikes.md](runtime-spikes.md#hermes) |
| **OpenClaw** | ⬜ | _to confirm_ | ? | ? | ? | ? | ? | [runtime-spikes.md](runtime-spikes.md#openclaw) |
| **OpenAI / Anthropic API** | Phase 6 | BYOK (local only) | n/a | ✅ | ✅ | n/a | tool-use | (provider layer) |

**Phase 5 exit:** ≥1 new runtime PoC (Codex ✅) + the others documented with blockers
([runtime-spikes.md](runtime-spikes.md)).
