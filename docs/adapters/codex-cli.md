<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 R Digital -->

# Discovery Spike — Codex CLI adapter

> **Runtime:** OpenAI Codex CLI (`@openai/codex`) · **Adapter:**
> [`packages/adapters/src/codex-cli.ts`](../../packages/adapters/src/codex-cli.ts) ·
> **Phase:** 5 (first non-Claude adapter, Open Q#4) · **Status:** PoC shipped.

This spike grounds every flag and event mapping in the adapter against the live Codex source
(`openai/codex`, the `sdk/typescript` event/item definitions and the published CLI reference) so
the adapter is faithful, not guessed. Capability claims here are **confirmed against the
documented surface**; the few best-effort items are called out under [Caveats](#caveats).

## Install / auth / version

| | |
|---|---|
| **Install** | `npm install -g @openai/codex` (also `brew install --cask codex`, or the `chatgpt.com/codex/install.sh` script) |
| **Auth** | run `codex` → *Sign in with ChatGPT*, **or** set `OPENAI_API_KEY` |
| **Version** | `codex --version` |
| **Config** | `~/.codex/config.toml` (MCP servers, model, sandbox defaults) |

`detect()` shells out to `codex --version` (resolving the binary via `which codex` / `where
codex`) and, when absent, returns a non-fatal `{ installed: false, message }` pointing at the
install + sign-in commands.

## Non-interactive surface

Codex has **no in-process Node driver** — its own SDK shells out to the same binary — so the
adapter spawns `codex exec` and parses its event stream. The prompt is written to **stdin**
(Codex reads stdin when no positional prompt is given), matching how OpenAI's SDK invokes it.

```
codex exec --experimental-json --sandbox workspace-write --cd <project> --skip-git-repo-check
   ⇐ prompt on stdin
```

### Flags the adapter uses

| Flag | Why |
|---|---|
| `exec` | non-interactive subcommand (vs. the interactive TUI) |
| `--experimental-json` | emit the JSONL event stream on stdout (what the official SDK sends on `main`; newer builds alias it `--json` — overridable via `jsonFlag`) |
| `--sandbox <mode>` | `read-only` \| `workspace-write` (default) \| `danger-full-access` |
| `--cd <path>` | project root the agent operates in |
| `--skip-git-repo-check` | `codex exec` refuses to run outside a git repo by default; the adapter runs in arbitrary roots, so it opts out explicitly |
| `--model <id>` | optional model override |
| `resume <thread_id>` | continue a prior thread (multi-turn continuity) |

## Event schema → RuntimeEvent mapping

`codex exec --experimental-json` writes **one JSON object per line**. Top-level *thread events*
carry a `type`; the three `item.*` events wrap a `ThreadItem` whose own `type` discriminates the
kind of work. Source: `openai/codex` `sdk/typescript/src/events.ts` + `items.ts`.

| Codex event | `item.type` | → `RuntimeEvent` | Notes |
|---|---|---|---|
| `thread.started` | — | `status` | `thread_id` captured for resume |
| `turn.started` | — | _(ignored)_ | |
| `item.started` / `item.updated` | any | _(ignored)_ | streaming deltas — avoids duplicate text |
| `item.completed` | `agent_message` | `output` | assistant text (`item.text`) |
| `item.completed` | `reasoning` | `thinking` | reasoning text (`item.text`) |
| `item.completed` | `command_execution` | `tool_call` | `command`, `status`, `exit_code` |
| `item.completed` | `mcp_tool_call` | `tool_call` | `server`/`tool` |
| `item.completed` | `file_change` | `tool_call` | `changes`, `status` |
| `item.completed` | `web_search` | `tool_call` | `query` |
| `item.completed` | `todo_list` | `status` | plan update |
| `item.completed` | `error` | `error` | `item.message` |
| `turn.completed` | — | `status` (terminal) | carries `usage` token counts |
| `turn.failed` | — | `error` (terminal) | `error.message` |
| `error` | — | `error` | top-level fatal |

The mapping lives in the **pure** `mapCodexEvent()` so it is unit-verifiable without a process;
`readOutput()` then streams `codex exec` stdout line-by-line through it, captures `thread_id` into
the session, ignores non-JSON noise, and emits a final `done` (or an `error` on a non-zero exit
that produced no events).

## Capabilities

| supports… | value | basis |
|---|---|---|
| interactive | ✅ | `codex` TUI |
| headless | ✅ | `codex exec` |
| JSON output | ✅ | `--experimental-json` JSONL |
| session resume | ✅ | `codex exec … resume <thread_id>` |
| MCP | ✅ | `mcp_servers` in `config.toml`; `codex mcp` |

## Verify

```bash
npm run verify-adapters     # injected fake spawn replays a canned JSONL transcript — no codex needed
```

Once Codex is installed locally, a real smoke is:

```bash
echo 'print "hello from codex"' | codex exec --experimental-json --skip-git-repo-check | head
```

…which should show `thread.started`, `item.completed`/`agent_message`, then `turn.completed`.

## Caveats

These are **best-effort / provisional** and to be re-confirmed against a live install (charter §8):

- **JSON flag drift.** The adapter defaults to `--experimental-json` (verified in OpenAI's SDK on
  `main`); newer Codex releases expose it as the stable `--json`. The `jsonFlag` option switches
  it without code changes. Both emit the identical event schema.
- **Resume argument order.** The adapter appends `resume <thread_id>` after the `exec` flags
  (mirroring the SDK). The canonical `codex exec resume <id>` subcommand form is equivalent; if a
  given build is strict about ordering this is the one spot to confirm live.
- **System prompt.** Codex `exec` has no `--system-prompt` flag; the adapter prepends the system
  prompt to the user turn (same approach as the Claude adapter). Native `AGENTS.md` / `--config`
  injection is a future enhancement.
- **Streaming.** Only settled `item.completed` events are surfaced, so output is per-item rather
  than token-streamed. Surfacing `item.updated` deltas is a deliberate future enhancement.
- **Sandbox default.** `workspace-write` lets the agent edit files in its `cwd`; tighten to
  `read-only` (or loosen to `danger-full-access`) via the `sandbox` option per deployment.
