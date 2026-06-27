# Agent Lobby Communication Protocol

> **Last updated:** 2026-04-06
> **Purpose:** Structured communication rules for multi-agent coordination in the Agent Lobby. Prevents message storms, resource exhaustion, and relay crashes.
> **Origin:** First live test (2026-03-29) with 7 agents crashed all relays within 2 minutes due to N² cross-acknowledgment cascade.
> **See also:** [boss-agent.md](sub-agents/agents/boss-agent.md), [SUB-AGENTS.md](SUB-AGENTS.md), [UI-ASSIST-GUIDE.md](UI-ASSIST-GUIDE.md)

---

## Problem This Solves

When N agents join a lobby and each responds to every other agent's messages, the message count explodes to N² per round. With 7 agents, a single "report in" command produced ~30 messages in under 2 minutes — each competing for WebSocket writes, overwhelming relay connections, and crashing the host machine.

This protocol replaces unstructured chatter with a disciplined communication model where the Boss Agent controls the floor.

---

## Core Rules

### Rule 1: Boss Controls the Floor

Only the **Boss Agent** (or the human reviewer) may initiate topics, assign tasks, or call on agents. All other agents are **silent by default** unless directly addressed or raising a hand (see Rule 3).

### Rule 2: Respond Only When Addressed

Agents MUST only send a lobby message when:
1. **Directly addressed by name** by the Boss Agent or human reviewer
2. **Raising a hand** (see Rule 3)
3. **Called on** after raising a hand
4. **Completing an assigned task** (status report to Boss only)

**Banned behaviors:**
- Acknowledging another agent's status report
- Responding to a message not directed at you
- Sending unprompted coordination offers to other agents
- Repeating your status when not asked

### Rule 3: Hand-Raise Protocol

Any agent may signal that they have relevant input. A hand-raise is **exactly one line**:

```
HAND [AgentName] — [reason in 5 words or fewer]
```

**Examples:**
```
HAND Backend — shared type change affects this
HAND Graph Navigator — circular dependency risk
HAND Product QA — breaks persona 4 workflow
HAND Security — RBAC gap in this endpoint
HAND Frontend — i18n key collision detected
```

**Hand-raise rules:**
- One line only. No tables, no details, no elaboration.
- The reason must be specific enough for the Boss to triage priority.
- Boss responds with `[AgentName], go ahead` or silence (silence = not now).
- Agent does NOT elaborate until called on.
- If called on, response stays **under 5 lines** unless Boss explicitly asks for full detail (`[AgentName], full detail`).
- Maximum **one hand-raise per agent per topic**. If ignored, do not repeat.
- Hand-raises are non-blocking — they do not interrupt the current speaker.

### Rule 4: Response Format

All lobby messages must be concise:

| Context | Max Length | Format |
|---------|-----------|--------|
| Roll call response | 1 line | `[AgentName] — ready` or `[AgentName] — ready, note: [one caveat]` |
| Hand-raise | 1 line | `HAND [AgentName] — [5-word reason]` |
| Called-on response | 5 lines | Direct answer, no preamble |
| Full detail (when asked) | 15 lines | Structured with bullet points |
| Task acceptance | 2 lines | `[AgentName] — accepted. Scope: [brief].` |
| Task completion | 3 lines | `[AgentName] — done. [one-line summary]. Ready for next.` |

**Banned formats:**
- Tables listing your capabilities (Boss already knows from agent definitions)
- Multi-paragraph status reports (unless explicitly requested)
- Acknowledgment messages ("Copy", "Acknowledged", "Roger that")
- Echoing back what the Boss just said

---

## Lobby Phases

### Phase 1: Roll Call (Sequential)

The Boss calls agents **one at a time** by name. Only the called agent responds.

```
Boss:     Backend, status?
Backend:  Backend — ready.
Boss:     Frontend, status?
Frontend: Frontend — ready.
Boss:     Graph Navigator, status?
Graph:    Graph Navigator — ready. Graph fresh (28 Mar).
```

**Not this:**
```
Boss:     Everyone report in.
[7 agents respond simultaneously with multi-paragraph status tables]
[Each agent acknowledges every other agent's response]
[30+ messages in 90 seconds, relays crash]
```

If the Boss needs all agents at once, use: `All agents, one-line status, connection order.` Agents respond in the order they connected — no cutting in line.

### Phase 2: Briefing (Mandatory — Never Skip)

Boss outlines the work scope **and proposed agent assignments**. All agents listen. Agents **SHOULD raise hands** during briefing if:
- They are better suited for a task than the proposed assignee
- They lack a tool or capability needed for the proposed task
- They spot a risk, dependency, or conflict in the plan
- The routing is wrong (e.g., code reviews going to non-review agents)

**Boss must pause after briefing** and ask: `Any hands before we execute?`

```
Boss:     5 PRs need code review (#1194-#1198). Plan:
          @code-review handles all 5 sequentially. Any hands?
HAND Backend — PR #1195 touches shared types, I should co-review
Boss:     @Backend, go ahead.
Backend:  #1195 changes shared/types/audit.ts which I own.
          I can review the type changes while code-review handles logic.
Boss:     Good. @code-review takes #1194, #1196-#1198.
          @Backend co-reviews #1195 types. Execute.
```

**Not this (Phase 2 skipped — real failure from 2026-04-06 test):**
```
Boss:     [immediately creates 5 tasks, broadcasts to *, no briefing]
          [agents don't HAND raise because they were never briefed]
          [code-review agent sits idle while random agents get reviews]
          [no ACK, no completion, no results]
```

### Phase 3: Execution (Directed)

Boss assigns tasks to **specific agents** using the routing table (CLAUDE.md → Sub-Agent System). Only the assigned agent responds. Other agents work silently on their own assignments or wait.

**Routing is mandatory.** Boss must match tasks to specialist agents:
- Code reviews → `code-review` agent
- Frontend changes → `frontend` agent
- Backend changes → `backend` agent
- See CLAUDE.md routing table for full mapping

**Never broadcast tasks to `*` (all agents).** Every task must target a named agent.

```
Boss:     @code-review, review PR #1198 for quality, patterns, security.
          Run gh pr diff 1198 for context. Report as ✅/⚠️/❌.
Code-Rev: code-review — accepted. Reviewing now.
          [works silently]
Code-Rev: code-review — done. PR #1198: ✅ overall.
          ⚠️ messages.js:85 — regex may miss \r\n on Windows.
          Ready for next.
```

During execution, other agents may hand-raise if they discover something relevant:
```
HAND Frontend — audit type missing 'actor_email' field
Boss:     @Frontend, go ahead.
Frontend: The AuditLog type in shared doesn't have actor_email but the
          design spec shows it in the table. Backend should add it.
Boss:     @Backend, add actor_email to AuditLog type before proceeding.
```

### Task Lifecycle (Assignment → ACK → Completion)

Every task follows this lifecycle. No exceptions.

**Step 1 — Assignment (Boss → Agent)**
```
Boss: @[AgentName], task: [description]. ACK?
```
Boss must target a SPECIFIC agent by name. Never broadcast tasks to `*`.

**Step 2 — ACK or NACK (Agent → Boss)**
```
Agent: [AgentName] — accepted. ETA: ~15 min.
  — or —
Agent: [AgentName] — NACK: [reason]. Suggest: @[OtherAgent].
```
If NACK, Boss reassigns to the suggested agent or another capable agent. If no ACK within 2 minutes, Boss pings: `@[AgentName], ACK on task?`

**Step 3 — Progress (Agent → Boss, every 5 min for tasks >10 min)**
```
Agent: [AgentName] — progress: 2/4 files done, tests passing.
```

**Step 4 — Completion or Failure (Agent → Boss)**
```
Agent: [AgentName] — done. [one-line summary]. Ready for next.
  — or —
Agent: [AgentName] — blocked: [specific reason].
```

**Step 5 — Timeout (Boss monitors)**
If no progress or completion within 2x ETA:
```
Boss: @[AgentName], status on task?
```
If no response in 2 minutes, Boss reassigns:
```
Boss: @[AgentName] unresponsive. @[OtherAgent], taking over: [task].
```

**Boss must track dispatched tasks** to prevent duplicates. Before creating a task, check: "Did I already dispatch this?" If yes, don't send again.

### Phase 4: Review & Handoff

Boss coordinates handoffs between agents:

```
Boss:     Backend is done. Frontend, the endpoint is at GET /api/v1/audit-logs.
          Response shape: { data: AuditLog[], pagination: {...} }.
          Build the viewer page per spec. Go.
Frontend: Frontend — accepted. Scope: page + api-client + tests.
```

### Phase 5: Close-Out

Boss runs through completion checks:

```
Boss:     All tasks reported done. Running close-out.
          Product QA, review the audit log module.
QA:       Product QA — accepted. Starting E12 checklist.
          [works]
QA:       Product QA — done. 2 findings:
          1. P2: AuditLogPage.tsx:45 — missing aria-label on filter dropdown
          2. P3: AuditLogPage.tsx:89 — date column not localized
Boss:     Frontend, fix those two. Then we close.
```

---

## Priority Tiers for Hand-Raise Triage

When agents raise hands, the Boss triages using these tiers:

| Tier | Signal | Boss Action |
|------|--------|-------------|
| **P0 — Blocking** | Something will break, crash, or violate a rule | Always call on immediately |
| **P1 — Correctness** | Wrong approach, missing requirement, type mismatch | Call on before the affected agent proceeds |
| **P2 — Quality** | Better approach exists, edge case spotted, a11y gap | Call on at next natural pause |
| **P3 — Nice-to-have** | Optimization, style suggestion, minor improvement | Call on if there's bandwidth, otherwise defer |

Agents should indicate urgency in their hand-raise reason when it's P0:

```
HAND Security — CRITICAL: endpoint has no auth check
```

---

## Connection Order Priority

When multiple agents need to respond (e.g., "All agents, one-line status"), the order is determined by **lobby connection timestamp** (first connected = first to respond).

The Boss can override this order for specific tasks but default ordering prevents agents from talking over each other.

The lobby coordinator provides connection order via the agent roster API.

---

## Boss Agent Responsibilities Under This Protocol

In addition to the existing Boss Agent role (see `boss-agent.md`), the Boss Agent must:

1. **Enforce floor discipline** — If an agent sends an unsolicited message, remind them: `[AgentName], hold. Wait to be addressed.`
2. **Run sequential roll call** — Never use "everyone report in" style prompts.
3. **Triage hand-raises promptly** — Don't let P0/P1 hand-raises sit unanswered.
4. **Keep the floor moving** — If an agent is taking too long, check in or reassign.
5. **Summarize for the human reviewer** — Periodically consolidate lobby state into a brief status update.

---

## Anti-Patterns (From the 2026-03-29 Incident)

| Anti-Pattern | What Happened | Rule That Prevents It |
|---|---|---|
| "Report in" broadcast | 7 agents sent multi-paragraph status tables simultaneously | Rule 1 (sequential roll call) |
| Cross-acknowledgment | Every agent acknowledged every other agent's message | Rule 2 (respond only when addressed) |
| Capability tables | Agents listed all their skills unprompted | Rule 4 (banned formats) |
| Coordination offers | Agents offered to help each other without being asked | Rule 2 (no unsolicited messages) |
| Echo chains | Agent A acknowledges B, B acknowledges A's acknowledgment | Rule 2 + Rule 4 (no acknowledgments) |
| Skipped briefing | Boss created tasks immediately without briefing agents or asking for hands | Phase 2 (mandatory briefing + "Any hands?") |
| Broadcast task dispatch | Tasks sent to `*` instead of specific agents — no one owned them | Phase 3 (target specific agents, never `*`) |
| Wrong specialist routing | Code reviews dispatched to random agents instead of code-review specialist | Phase 3 (use CLAUDE.md routing table) |
| No ACK protocol | Boss assumed agents received tasks — no confirmation, no NACK | Task Lifecycle (ACK/NACK required) |
| Duplicate dispatch | Same task sent twice because boss had no dispatch log | Task Lifecycle (track dispatched tasks) |
| Silent failure | Agents couldn't execute (no gh CLI) but never reported back | Task Lifecycle (NACK + failure reporting) |

---

## Human Participants

Human participants join the lobby through the browser UI as authenticated admin users. They appear in the roster with `participant_type: 'human'` and are fundamentally different from agent sessions.

### Exemptions

- **Humans are exempt from hand-raise protocol.** They may speak at any time without raising a hand.
- **Humans are exempt from response format limits.** They may send messages of any length in any format.
- **Humans are not bound by floor control.** They may address any agent or broadcast freely.

### Agent Behavior When Humans Are Present

- **Agents must not address humans directly** unless the Boss Agent explicitly routes a question to them. If a human asks a question in the lobby, agents should wait for the Boss Agent to respond or delegate.
- **When a human speaks, agents hold.** The Boss Agent responds first. If the Boss Agent routes a question to a specific agent, that agent may then respond.
- **Never send unsolicited status reports or capability tables to human participants.** This is the primary anti-pattern from the 2026-03-28 flood incident.
- **Human messages are high-priority input.** Treat them with the same weight as reviewer directives.

---

## Adding This Protocol to Agent Prompts

Every agent connecting to the lobby MUST have the following in its system prompt or receive it as a lobby system message upon connection:

```
LOBBY PROTOCOL (mandatory):
- Silent by default. Only respond when addressed by name by the Boss Agent.
- To offer input: send exactly one line: HAND [YourName] — [5-word reason]
- Wait for "go ahead" before elaborating. Silence from Boss = not now.
- During briefing: HAND raise if you are better suited for a proposed task,
  if you lack a tool needed, or if you spot a risk in the plan.
- When assigned a task: respond with ACK ("accepted, ETA: ~X min") or
  NACK ("can't — [reason]. Suggest: @[OtherAgent]").
- Max response: 5 lines unless Boss says "full detail".
- Never acknowledge other agents' messages.
- Never send capability tables, status reports, or coordination offers unprompted.
- Connection order determines speaking priority when Boss addresses all agents.
```

This can be injected by the relay server as a system message when an agent joins the lobby, or included in the agent prompt template in SUB-AGENTS.md.

---

## Agent OS Panel — Lobby View

> **Added 2026-04-04 — Sprint 38.5.0**

The Agent OS Panel (`npm run agent-os-panel`) provides a Lobby tab that visualizes the lobby state locally:

- **Floor control** — phase switching (idle → roll-call → briefing → execution → review → close-out)
- **Agent presence** — online/offline agent cards with status dots, scope, PID
- **Hand-raise indicators** — shows which agents have raised hands
- **Boss Agent designation** — highlighted with badge

### Multi-Panel Support

Multiple developers can each run `npm run agent-os-panel -- --lobby https://staging.example.com` on their own machines. When all panels point to the same staging lobby URL:

- **All agents from all panels appear in a unified roster** — the Lobby tab shows "Remote Lobby Roster (all panels combined)" via the `/api/lobby/roster` endpoint
- **Agent names are disambiguated** — when a lobby URL is configured, agents register as `hostname-slug-port` (e.g., `dev1-backend-4800`) instead of bare `backend`
- **No identity collisions** — the backend assigns each agent a unique ULID `agent_id` regardless of display name
- **Broadcast isolation** — only agents in the same lobby see messages (enforced server-side)
- **Boss Agent controls floor** — non-Boss agents cannot broadcast (server-enforced, prevents echo cascades)
