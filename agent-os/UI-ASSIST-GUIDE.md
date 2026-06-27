# UI Assist — Usage Guide

> **Last updated:** 2026-04-04
> **Sprint:** 17.8.0
> **See also:** [UI-ASSIST.md](UI-ASSIST.md) for interaction rules, button behavior, and response formatting
> **Extension:** [Agent Lobby](sub-agents/agents/boss-agent.md) extends UI Assist for multi-session coordination via the Agent Lobby (`src/backend/src/modules/agent-lobby/`)
> **Localhost panel:** `npm run agent-os-panel` provides a standalone Assist tab (Chat, Tasks, Sprint sub-views) that connects to the relay at `ws://localhost:4722`

## Prerequisites

| Requirement | Detail |
|-------------|--------|
| **Role** | `system_admin` with `ui_assist.execute` permission |
| **Feature flag** | `ENABLE_UI_ASSIST=true` environment variable set on the server |
| **Claude Code CLI** | Installed locally (`npm install -g @anthropic-ai/claude-code`) |
| **Claude login** | Authenticated via `claude login` (uses Claude Max subscription — no API key needed) |
| **Relay server** | Running locally via `npm run relay` (starts on `ws://localhost:4722`) |

## Activation

1. **Toolbar** — When UI Assist is enabled, a floating toolbar appears at the edge of the admin layout. Click the toggle button to activate selection mode.
2. **Keyboard shortcut** — Hold `Alt` to temporarily activate selection mode (release to deactivate). This can be changed to toggle mode in toolbar settings.

> **Note:** The activation shortcut is suppressed inside text inputs, textareas, and contentEditable fields to avoid interfering with normal editing.

## Selecting Elements

| Action | Result |
|--------|--------|
| **Hover** | Highlights the element with a selection box and floating label showing the React component name (e.g., `<TaskSummaryWidget>`) |
| **Click** | Selects the hovered element and captures its context |
| **Click + Drag** | Draws a rectangle to select multiple elements at once |
| **Arrow keys** | Navigate to parent (`↑`), child (`↓`), or sibling (`←` `→`) elements |
| **Escape** | Cancel current selection or deactivate selection mode |

## Sending a Prompt

After selecting one or more elements:

1. An **inline prompt input** appears near the selected element
2. Type your instruction (e.g., "Change this card to use a dark theme" or "Add a loading spinner to this table")
3. Press **Enter** to send (Shift+Enter for newline) or click **Send to Claude Code**
4. A **session panel** shows streaming progress with tabs for Chat, Tasks, Sprint, and Sessions
5. When complete, you can **Undo** the changes, **Dismiss** the card, expand to full viewport, or continue with another selection

## Session Controls

| Control | Description |
|---------|-------------|
| **Abort** | Stops the current Claude Code session (with confirmation) |
| **Undo** | Reverts the last set of changes made by Claude Code |
| **Redo** | Re-applies undone changes |
| **Retry** | Re-sends the last prompt on error |
| **Dismiss** | Closes the session status card |
| **Expand/Collapse** | Toggle between side panel (420px) and full viewport mode |

## Session History & Persistence

Sessions are **persisted server-side in MongoDB** (`grc_ui_assist_sessions` collection) — they survive page reloads and browser restarts.

The **Sessions** tab provides:
- **In-memory sessions** listed most-recent-first with live status indicators
- **Persisted sessions** (from MongoDB) shown below with message count and "Load" button
- Click any session to switch to it
- **Archive/Delete** — hover a session to reveal the archive button
- **Start New Session** button — always visible
- Session context (including Claude's internal session_id) is preserved for multi-turn resume

Backend API endpoints:
- `GET /api/v1/ui-assist/sessions` — list user's sessions
- `GET /api/v1/ui-assist/sessions/:id` — fetch full session with messages
- `POST /api/v1/ui-assist/sessions/:id/messages` — append message
- `PATCH /api/v1/ui-assist/sessions/:id/status` — mark complete/error
- `DELETE /api/v1/ui-assist/sessions/:id` — delete session

## Architecture

```
You (browser)          Native Relay (npm run relay)    Claude Code (CLI)     Project Backend (DB)
─────────────          ─────────────────────────       ─────────────────     ─────────────────────
Select element ──┐
Type prompt      │
                 ├──► WebSocket (ws://localhost:4722)
                 │    ├─ HTML content sanitization
                 │    ├─ Context delimiter wrapping
                 │    ├─ Agent OS system prompt injection
                 │    └─ Session tracking + timeout
                 │         │
                 │         ├──► @anthropic-ai/claude-agent-sdk query()
                 │         │    (acceptEdits mode, session resume)
                 │         │    Auth: claude login (Max subscription)
                 │         │
                 │    ◄────┤    Streaming status updates
Stream response ◄┘         │
                      ◄────┘    Done / Error
                 │
                 ├──► POST /api/v1/ui-assist/sessions/:id/messages ──► MongoDB (grc_ui_assist_sessions)
                 │    Session persistence (survives page reload)
```

## Agent Lobby (Multi-Session Extension)

The Agent Lobby extends UI Assist to support multiple concurrent Claude CLI sessions coordinating through a shared staging interface.

```
Claude CLI Session A ──► Relay A ──► RelayLobbyBridge ──┐
Claude CLI Session B ──► Relay B ──► RelayLobbyBridge ──┤──► LobbyCoordinator (backend)
Claude CLI Session N ──► Relay N ──► RelayLobbyBridge ──┘    ↕ WebSocket (ws)
                                                         Browser (LobbyPanel) ◄──► Human Reviewer
                                                              ↕ REST API
                                                         MongoDB (4 collections)
```

**Endpoints:**
- `ws://.../api/v1/agent-lobby/ws/agent` — relay-to-coordinator WebSocket (agent connections)
- `ws://.../api/v1/agent-lobby/ws/browser` — browser-to-coordinator WebSocket (reviewer connections)
- `GET/POST /api/v1/agent-lobby/lobbies` — lobby CRUD
- `GET /api/v1/agent-lobby/lobbies/:id/agents` — connected agent roster
- `GET /api/v1/agent-lobby/lobbies/:id/messages` — message stream
- `GET/POST /api/v1/agent-lobby/lobbies/:id/requests` — human approval queue
- `POST /api/v1/agent-lobby/lobbies/:id/requests/:id/decide` — approve/reject/defer

**Permissions:** `agent_lobby:view`, `agent_lobby:manage`, `agent_lobby:decide` (system_admin only)

### Quick Start — Agent Lobby

**Step 1: Create a lobby** in the staging UI:
1. Open UI Assist on the staging site (e.g. `https://your-lobby.example.com/admin`)
2. Click the **Lobby** tab
3. Enter a name (e.g. "Sprint 34.0 Coordination") and click **Create Lobby**

**Step 2: Connect Claude CLI sessions** via the relay server:

```bash
# Basic relay (no lobby)
npm run relay

# Relay with auto-discovery — finds the active lobby automatically
npm run relay -- --lobby https://your-lobby.example.com

# With specialist agent role (reads agent definition, injects into session context)
npm run relay -- --lobby https://your-lobby.example.com --agent-role frontend-specialist

# Override agent name (default: hostname-role-port or hostname-branch-port)
npm run relay -- --lobby https://your-lobby.example.com --agent-name "frontend-lead"

# Multiple specialist agents on different ports (same machine)
npm run relay -- --port 4722 --lobby https://your-lobby.example.com --agent-role frontend-specialist
npm run relay -- --port 4723 --lobby https://your-lobby.example.com --agent-role compliance-specialist
npm run relay -- --port 4724 --lobby https://your-lobby.example.com --agent-role test-specialist
npm run relay -- --port 4725 --lobby https://your-lobby.example.com --agent-role i18n-specialist
npm run relay -- --port 4726 --lobby https://your-lobby.example.com --agent-role product-qa
```

The relay auto-discovers the active lobby via `GET /api/v1/agent-lobby/discover` (public, no auth). Agent name defaults to `hostname-role-port` (e.g. `ronni-pc-frontend-specialist-4722`).

**Agent role behavior:**
- `--agent-role` reads the agent definition from `agent-os/sub-agents/agents/<role>.md`
- First query in a session gets the full definition injected (~500-2000 tokens, one-time)
- Subsequent queries get a lightweight role tag (~50 tokens)
- The role is displayed as a badge on the agent card in the lobby UI
- Available roles: any `.md` file in `agent-os/sub-agents/agents/` (see SUB-AGENTS.md for the full roster)

**Step 3: Verify connection** — the staging Lobby tab should show connected agents with status indicators.

**Step 4: Appoint Boss Agent** — click "Appoint as Boss Agent" on one of the connected agents.

**Hardening (Phase 1):**
- **Single lobby per org** — `POST /lobbies` returns 409 if an active lobby already exists. Close the current lobby before creating a new one.
- **Boss Agent crash recovery** — 3x heartbeat grace period (270s vs 90s for regular agents). On stale cleanup, `lobby-boss-lost` event broadcast to browser with remaining agent roster for immediate re-appointment.
- **Reconnect identity preservation** — if a crashed agent reconnects within 5 minutes with the same PID + branch + cwd, the existing `agent_id` is reused and message history is preserved.
- **Monotonic message ordering** — each message gets an atomic `seq` counter (per-lobby `$inc` on MongoDB). All queries sort by `seq` instead of `created_at`. Client-side gap detection in `useLobby.ts` backfills missed messages via REST when a sequence gap is detected.

## Security Notes

- Claude Code is invoked via `@anthropic-ai/claude-agent-sdk` `query()` with **session resume**, **signal-based abort**, and **SDK-managed undo/redo**
- **No API key needed** — uses Claude Max subscription authentication via `claude login`
- All captured HTML is **sanitized** — `<script>`, `<style>`, event handlers, `data-*` attributes, and `javascript:` URIs are stripped
- Captured context is **wrapped in structured delimiters** (`--- CAPTURED UI CONTEXT ---`) to prevent prompt injection
- Claude Code runs with **`acceptEdits`** permission mode — prompts for destructive operations
- Working directory controlled via relay's **`--cwd` flag** (default: `process.cwd()`)
- All operations are **audit logged** (`ui_assist.session_start`, `ui_assist.prompt_sent`, etc.)
- Relay uses **30-second heartbeat** to detect stale connections
- Maximum prompt: **5,000 chars**; maximum captured context: **50,000 chars**
- Sessions scoped per user in MongoDB — accessible only by session owner
- Relay injects **Agent OS-aware system prompt** with codebase navigation rules
