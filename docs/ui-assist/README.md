<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 R Digital -->

# UI Assist — embeddable overlay & integration

UI Assist is the in-page developer overlay for Agent OS Protocol: a floating launcher + chat panel a
developer embeds in **their own app** to talk to an agent runtime about the UI in front of them —
discuss a bug, propose a fix, and (with explicit permission) have the agent edit files and commit to
a feature branch. Phase 9 ships the **neutral, verifiable core**: the event contract, the
embeddable `<script>`, and the Integration Agent that wires it into eight frameworks. It reuses the
already-extracted relay as the browser↔runtime bridge (IMPLEMENTATION-PLAN.md §12).

It is **product-neutral** (no domain branding or copy), **local-first** (connects to your own relay),
and **safe by default** (suggest-only until you grant edit authority).

## Architecture

```
 browser app  ──<embed.js>──►  UI Assist overlay
                                   │  speaks the UI Assist event contract (ui-assist-core)
                                   ▼
                            relay  (npm run relay, ws://localhost:4722)   ── bridges to ──►  agent runtime
                                   │  (Swarm Mode: relay --lobby <url>)
                                   ▼
                            lobby-server  (remote, accountable swarm)
```

| Layer | Package | Role |
|---|---|---|
| Contract / session / safety | `@agent-os/ui-assist-core` | The event contract, the transport seam, the session state machine, the permission gate, the response-rendering rule, and the integration engine. No DOM, no socket — all injected, so it verifies in Node. |
| Embeddable overlay | `@agent-os/ui-assist-embed` | `embed.js` — a dependency-free browser `<script>` (drop-in, no build step) that renders the overlay and speaks the contract to the relay. |
| Browser↔runtime bridge | `packages/relay` | The de-branded relay (`npm run relay`) — already implements the bridge; the overlay connects to it locally, or to a lobby remotely. |
| Connections | `@agent-os/protocol-core`, `@agent-os/lobby-client` | Canonical work-item types (the "add to sprint plan" path) and the typed lobby client for Swarm Mode. |

## Event contract

The overlay and the bridge exchange a small, stable set of JSON frames (`ui-assist-core/contract.ts`),
named to match the relay wire byte-for-byte (the protocol-stability principle, §4):

- **client → bridge:** `agent-request` (with `{ content[], prompt, sessionId }`), `agent-abort`,
  `agent-undo`, `agent-redo`, `health`.
- **bridge → client:** `agent-status` (streamed, by `messageIndex`), `agent-done`, `agent-error`,
  `health`, `handlers` (the runtime ids the bridge advertises).

The session adopts the advertised handler id from `handlers`, streams `agent-status` chunks into the
panel, and finalises on `agent-done` / `agent-error`.

## Safety — suggest-only by default

UI Assist **cannot edit a project without explicit permission** (§12 / charter §14). This is enforced
client-side, in front of the relay's own "never act without confirmation" system prompt:

- The overlay opens in **`suggest`** mode — it discusses, analyses, and proposes; it does not
  authorise edits or commits.
- Switching to **`act`** is an explicit developer gesture, guarded by a confirmation. Only then does a
  turn carry a machine-readable authorisation marker the runtime looks for.
- A turn requested as `act` while still in `suggest` mode is **blocked before it reaches the wire** —
  see `PermissionGate` and the session's `permission-required` event.
- The agent commits to a **feature branch** and never merges to main (merging stays manual).

No provider keys ever leave the machine; a remote lobby connection carries none (BYOK — see
[`../providers/README.md`](../providers/README.md)).

## Quick start (plain JS)

```bash
npm run relay                      # bridge at ws://localhost:4722
```

Serve `packages/ui-assist-embed/embed.js` from your app and add, in your **dev** build only:

```html
<script type="module">
  import { mountUiAssist } from '/agent-os/ui-assist/embed.js';
  mountUiAssist({ relayUrl: 'ws://localhost:4722' });
</script>
```

Open the page and click the ✦ launcher. A self-contained demo lives at
[`../../packages/ui-assist-embed/embed.html`](../../packages/ui-assist-embed/embed.html).

## Framework integration

The **Integration Agent** detects your project type and emits the right embed, install checks, and a
secure-connect summary. Run it against any project:

```bash
npm run ui-assist-integrate -- /path/to/app                 # prints a ready-to-apply plan
npm run ui-assist-integrate -- /path/to/app --json          # machine-readable
npm run ui-assist-integrate -- /path/to/app --lobby wss://lobby.example.com
```

Supported targets: **plain JS, React, Next.js, Vue, Svelte, Laravel/Blade, WordPress, Joomla.**
Full per-framework snippets are in [`frameworks.md`](frameworks.md) (and emitted by the command
above). The agent definition is
[`agent-os/sub-agents/agents/ui-assist-integration.md`](../../agent-os/sub-agents/agents/ui-assist-integration.md).

## Verify

```bash
npm run verify-ui-assist
```

A no-network, no-browser harness (`agent-os/scripts/verify-ui-assist.ts`): it exercises the contract,
transport, session, permission gate, and renderer over an injected fake WebSocket; mounts `embed.js`
itself through a DOM/WebSocket stub (and cross-checks its action parser against the core so the two
cannot drift); and runs the integration engine across all eight targets.

## What ships (and what is deferred)

| Capability | State | Where |
|---|---|---|
| Event contract + transport seam + session + permission gate | ✅ shipped | `@agent-os/ui-assist-core` |
| Repo-local embeddable `<script>` overlay + demo page | ✅ shipped | `@agent-os/ui-assist-embed` |
| Integration engine (detect + plan) for 8 frameworks + CLI | ✅ shipped | `ui-assist-core/integration.ts`, `agent-os/scripts/ui-assist-integrate.ts` |
| "Add to sprint plan" → canonical `Task` records | ✅ shipped | `ui-assist-core/tasks.ts` (§12A item 6) |
| Bundled/minified `dist` + npm-published framework wrapper packages (`-react`/`-next`/`-vue`/…) | ⛔ deferred | needs a bundler + npm publish (Open Q#9: repo-local script first) |
| Live framework install validation (real React/Next/WP/Joomla apps) | ⛔ deferred | needs those toolchains in CI |

The deferred parts are infra-gated (a bundler, an npm registry, live framework toolchains); the
repo-local `<script>` is the verifiable core a developer can use today.
