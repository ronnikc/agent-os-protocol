# planning.md — Agent OS Protocol Independent Platform

> **Audience:** Claude Code / Claude CLI working inside the new Agent OS Protocol repository.  
> **Project:** Fork Agent OS Protocol into an independent, public platform while keeping the AesirX ComplianceOne implementation fully intact.  
> **Primary repository:** `https://github.com/ronnikc/agent-os-protocol`  
> **Critical boundary:** Only work in the independent Agent OS Protocol / Agent OS Panel repository. Do **not** change `grc-suite` or any AesirX ComplianceOne repository.

---

## 0. Claude Execution Instruction

Claude, your task is to create the final technical implementation plan and then implement only after explicit approval from Ronni.

Before doing anything:

1. Run `pwd`, `git remote -v`, and `git status`.
2. Confirm that the active repository is the independent Agent OS Protocol repository, or the dedicated Agent OS Panel repository if that is where this fork currently lives.
3. If the active repository is `grc-suite`, `AesirX ComplianceOne`, or any AesirX production repo, **stop immediately**.
4. Do not edit, format, lint-fix, rename, move, or delete any file in `grc-suite`.
5. If `grc-suite` exists nearby in the workspace, treat it as **read-only reference only**.
6. Do not create symlinks, submodules, scripts, or path references that write back to `grc-suite`.
7. Do not run broad commands from a parent directory that could touch both repos, such as parent-level formatters, recursive replacements, or monorepo-wide codemods.

First deliverable:

- Create or update a final implementation plan in this repository.
- Do **not** begin full implementation until the plan is reviewed and approved.

---

## 1. Project Goal

Fork the Agent OS Protocol work developed during AesirX ComplianceOne into an independent platform for agentic software development, vibe coding, multi-agent coordination, training, UI assistance, and accountable remote swarm lobbies.

The AesirX ComplianceOne version must remain fully intact. This project becomes a standalone platform with no direct AesirX ComplianceOne dependencies, no ComplianceOne-specific agents, and no ComplianceOne-specific memories, skills, links, branding, or staging URLs.

The independent Agent OS Protocol should support:

- Local agent orchestration through Agent OS Panel.
- Remote swarm mode through a new Agent Lobby hosted outside ComplianceOne.
- Public and private lobbies.
- Agent identity and accountability through Concordium Agent Registry.
- Generic domain-specialist agents that can be trained with skills and knowledge.
- `/train [agent]` command for adding domain knowledge to a selected agent.
- Existing Claude CLI relay flow.
- Additional adapter support for OpenAI Codex CLI, OpenCode, Hermes Agent, OpenClaw, Cursor, and future CLIs.
- API-based agent fuel through OpenAI-compatible and Anthropic-compatible providers.
- Agent OS UI Assist integration into user projects.

---

## 2. Current Source Context

The current README describes Agent OS as an orchestration system for AI-assisted development at scale with:

- 30 specialized sub-agents.
- 79 skill modules.
- Agent memories, layered memory index, facts ledger, diaries, and optional semantic recall.
- Governance files such as `RULES.md`, `SPRINTS.md`, `SUB-AGENTS.md`, `ARCHITECTURE.md`, `MEMORY.md`, `LOBBY-PROTOCOL.md`, `UI-ASSIST.md`, `ETHICS.md`, and `SOUL.md`.
- Agent OS Panel as a localhost control plane.
- Local Agent Mode with built-in local lobby.
- Agent Swarm Mode using a remote lobby URL.
- A relay server that can be auto-started by the panel.
- Panel tabs for Agents, Scheduled tasks, Lobby, Messages, Tasks, Assist, Files, and Gantt.
- Shared-memory JSONL communication.
- Enforcement hooks, observations, graph intelligence, and sprint gates.

The fork must preserve the general architecture, but neutralize all AesirX ComplianceOne-specific content.

---

## 3. Non-Negotiable Repository Boundary

### Allowed

Claude may plan changes for the independent Agent OS Protocol repository, including:

- `agent-os/**`
- `agent-os-panel/**`
- `scripts/**`
- `shared-memory/**`
- `observations/**`
- `docs/**`
- `packages/**`
- `apps/**`
- root docs such as `README.md`, `CLAUDE.md`, `planning.md`, `package.json`, and config files in the independent repo.

### Forbidden

Claude must not change:

- `grc-suite/**`
- any AesirX ComplianceOne application code
- any ComplianceOne staging or demo app
- any production AesirX repository
- any shared local parent folder that includes multiple repos
- any file outside the independent Agent OS Protocol repo unless Ronni explicitly says otherwise

### Safety Check Before Each Phase

At the start of each phase, Claude must verify:

```bash
pwd
git remote -v
git status --short
```

If the remote or path indicates `grc-suite`, Claude must stop.

---

## 4. Product Positioning

### Working Product Name

Use:

- **Agent OS Protocol**
- **Agent OS Panel**
- **Agent OS UI Assist**
- **Agent OS Lobby**
- **Agent OS Relay**
- **Agent OS Swarm Mode**

Do not use:

- AesirX ComplianceOne
- ComplianceOne Agent OS
- ComplianceOne Content Agent
- Compliance Agent when it means AesirX-specific compliance
- `complianceone.demo.aesirx.io`
- `aesirx.io` except in migration notes or historical references

### Target Users

Primary initial users:

- Vibe coders.
- Solo developers using Claude CLI, Codex CLI, OpenCode, Cursor, or other coding agents.
- Small teams coordinating multiple AI agents.
- Developers who want UI Assist inside their own app.
- Developers who want private agent lobbies with identity accountability.
- Builders who want to train specialized agents using their own skills and knowledge.

Secondary users:

- Agencies.
- Open-source maintainers.
- Product teams.
- Compliance, legal, security, research, and content teams that want generic trained domain agents.

---

## 5. Strategic Architecture Decision

Separate Agent OS into four conceptual layers:

| Layer | Purpose | Example Components |
|---|---|---|
| Protocol Core | Governance, sub-agents, skills, memory, sprint gates, commands | `agent-os/**`, `sub-agents/**`, `memories/**`, `rules/**` |
| Local Control Plane | Local browser panel, relay launcher, local lobby, tasks, messages | `agent-os-panel/**`, `scripts/agent-os-panel-server.ts` |
| Swarm Lobby Platform | Remote lobby creation, public/private lobbies, identity, roster, messages, task exchange | `apps/lobby-web/**`, `packages/lobby-client/**` |
| Agent Runtime Adapters | Bridges to Claude CLI, Codex CLI, OpenCode, Cursor, Hermes, OpenClaw, API providers | `packages/adapters/**`, `relay-server.ts` |

Do not hardwire the product to one agent runtime. The relay and lobby should speak a stable internal protocol; each CLI or API provider should be an adapter.

---

## 6. Required De-Coupling From AesirX ComplianceOne

Claude must plan and then execute a full neutralization pass.

### Search Targets

Use case-sensitive and case-insensitive searches for:

```bash
AesirX
AesirX.io
ComplianceOne
complianceone
compliance-one
complianceone.demo.aesirx.io
grc-suite
GRC Suite
Forseti
PDPL
DPIA
TIA
DSR
DSAR
Decree
Vietnam
MPS
```

Do not blindly delete every match. Classify each occurrence:

| Classification | Action |
|---|---|
| Product-specific branding | Replace with Agent OS Protocol naming |
| Product-specific agents | Remove, retire, or convert to generic agent templates |
| Product-specific skills | Remove or convert only if broadly useful |
| Product-specific memories | Remove from default distribution |
| Historical migration note | Keep only in `MIGRATION.md` or similar, clearly marked |
| Generic engineering pattern | Keep after removing ComplianceOne-specific nouns |
| Legal/regulatory content | Remove from default protocol unless converted into optional domain pack |

### Acceptance Criteria

After implementation, this command should return no product-specific runtime references:

```bash
grep -RniE "AesirX|ComplianceOne|complianceone\.demo|grc-suite|Forseti" . \
  --exclude-dir=.git \
  --exclude-dir=node_modules
```

Allowed exceptions must be documented in a `MIGRATION.md` or `docs/history.md` file.

---

## 7. Agent Roster Transformation

The existing system includes strong agent categories. Keep the general structure, but make it generic.

### Keep / Generalize

Keep these categories in project-neutral form:

| Current Type | New Generic Role |
|---|---|
| Planning | Planning Orchestrator |
| Research | Research Specialist |
| Backend | Backend Specialist |
| Frontend | Frontend Specialist |
| API | API Integration Specialist |
| Test | Test Specialist |
| Code Review | Code Review Specialist |
| Build Integrity | Build Integrity Specialist |
| Graph Navigator | Graph Navigator |
| Security | Security Specialist |
| I18N | Localization Specialist |
| Accessibility | Accessibility Specialist |
| Legal | Policy / Legal Research Specialist, optional |
| Documentation | Documentation Specialist |
| Release | Release Specialist |
| Infrastructure | Infrastructure Specialist |
| Product | Product Specialist |
| UX | UX Specialist |
| Design | Design Specialist |
| UI Assist | UI Assist Integration Specialist |
| User Validation | User Validation Specialist |
| Content | Content Specialist |
| SEO | SEO Specialist |

### Convert Compliance-Specific Agents

Replace AesirX-specific compliance agents with generic domain agent patterns:

| Old Agent Concept | New Concept |
|---|---|
| Compliance Agent | Domain Specialist Agent |
| ComplianceOne Content Agent | Domain Content Specialist |
| Regulatory Framework Agent | Trainable Knowledge Domain Agent |
| Sector Overlay Agent | Optional Domain Pack Agent |

The base platform should ship with a generic **Domain Specialist Agent** that has no built-in AesirX or ComplianceOne knowledge. It should learn through `/train [agent]`.

---

## 8. New Agents To Add

Claude should plan new agents that directly support the independent platform.

### 8.1 Identity Agent

Purpose:

- Help users register, verify, and manage agent identity.
- Interact with Concordium Agent Registry where possible.
- Validate whether an agent has an identity anchor.
- Assist with agent card creation and metadata.
- Support private lobby access policies tied to registered agent IDs.

Initial responsibilities:

- Explain required identity setup.
- Generate local agent card drafts.
- Validate agent card schema.
- Connect a local agent profile to a registry reference.
- Prepare registration instructions or transaction payloads, depending on available SDK support.
- Verify registry lookups through an indexer or API.
- Maintain clear separation between public agent identity, private keys, and human identity data.

### 8.2 Lobby Architect Agent

Purpose:

- Specialize in lobby design, WebSocket protocol, roster management, floor control, hand-raise rules, boss agent behavior, task exchange, and private access controls.

### 8.3 Runtime Adapter Agent

Purpose:

- Specialize in adding or maintaining CLI/API integrations.
- Own adapter contracts for Claude CLI, Codex CLI, OpenCode, Hermes Agent, OpenClaw, Cursor, and future tools.

### 8.4 UI Assist Integration Agent

Purpose:

- Help developers integrate Agent OS UI Assist into their own app.
- Generate integration instructions for React, Vue, plain JS, Next.js, Laravel, WordPress, Joomla, or other targets.
- Provide installation checks, embed scripts, component scaffolding, and event contracts.
- Ensure UI Assist remains product-neutral.

### 8.5 Training Agent

Purpose:

- Own `/train [agent]`.
- Convert user-supplied Markdown, docs, examples, code patterns, and command instructions into structured skills and memory entries.
- Validate skill format.
- Avoid overwriting core instructions.
- Track source provenance and update dates.
- Support reversible training packs.

---

## 9. `/train [agent]` Command Design

The independent platform needs an agent training flow.

### Command Syntax

Initial command:

```text
/train [agent-slug]
```

Optional future syntax:

```text
/train [agent-slug] --source ./docs/domain.md
/train [agent-slug] --skill "privacy-review"
/train [agent-slug] --pack ./training-packs/security-basics
/train [agent-slug] --mode append
/train [agent-slug] --mode review
/train [agent-slug] --dry-run
```

### Training Inputs

Support:

- Markdown documents.
- Text files.
- Code snippets.
- API docs.
- Design patterns.
- Checklists.
- Playbooks.
- Existing skill directories.
- JSON/YAML structured knowledge packs.

### Training Outputs

Claude should plan a structure like:

```text
agent-os/
  training/
    inbox/
    reviewed/
    rejected/
    packs/
  sub-agents/
    agents/
      domain-specialist.md
    skills/
      trained/
        [agent-slug]/
          [skill-name]/
            SKILL.md
            references/
            metadata.json
    memories/
      trained/
        [agent-slug]/
          diary.md
          facts.jsonl
```

### Training Safety

The training flow must:

- Never silently overwrite core rules.
- Never insert project-specific knowledge into base agents unless explicitly requested.
- Keep trained knowledge separated from core distribution.
- Add source metadata.
- Add a review step before activation.
- Support removal or disabling of a training pack.
- Detect secrets and reject training files that contain private keys, tokens, passwords, or `.env` content.
- Avoid training on proprietary AesirX ComplianceOne material unless Ronni explicitly moves it into an allowed training pack.

### Acceptance Criteria

- `/train backend-specialist --dry-run` shows what would be added.
- `/train domain-specialist --source ./docs/example.md` creates a reviewable skill draft.
- Training pack activation is explicit.
- Generated skill paths are deterministic.
- Training does not modify unrelated agents.

---

## 10. Agent Lobby Platform

The current panel supports local mode and swarm mode using a lobby URL. The independent platform needs its own lobby platform.

### Initial Hosting

Ronni plans to initially launch a lobby website on Vercel while testing.

Claude must account for the following:

- WebSockets on Vercel Functions are in public beta as of June 2026, so design defensively.
- Do not depend on in-memory Vercel function state for durable lobby state.
- Use durable storage for lobby state, roster, messages, task queue, and identity bindings.
- Prefer Redis/Postgres or another durable store for state.
- Add a fallback deployment option for a persistent Node.js server if Vercel WebSocket limits become a blocker.
- Keep the lobby protocol portable.

### Lobby Types

Support:

| Lobby Type | Description |
|---|---|
| Local | Runs on the user's machine through Agent OS Panel |
| Public Remote | Anyone with lobby URL can join, subject to optional rate limits |
| Private Remote | Requires authorization through agent identity / allowlist / invite |
| Team Remote | Organization-managed private lobby, future phase |

### Lobby Core Objects

Plan schemas for:

```ts
Lobby {
  id: string
  slug: string
  name: string
  visibility: "public" | "private"
  ownerAccount?: string
  requiredRegistry?: "none" | "agent-id" | "agent-id-with-human-link" | "org-id"
  createdAt: string
  updatedAt: string
}

AgentParticipant {
  lobbyId: string
  agentId: string
  displayName: string
  localSlug: string
  hostFingerprint?: string
  runtime: "claude-cli" | "codex-cli" | "opencode" | "cursor" | "hermes" | "openclaw" | "api" | "unknown"
  registryRef?: ConcordiumAgentRef
  status: "joining" | "active" | "idle" | "left" | "blocked"
  isBoss: boolean
  joinedAt: string
  lastSeenAt: string
}

ConcordiumAgentRef {
  network: "mainnet" | "testnet"
  contractIndex?: number
  contractSubindex?: number
  tokenId?: string
  agentCardUrl?: string
  agentCardHash?: string
  externalReference?: string
  verificationStatus: "unverified" | "verified" | "failed" | "pending"
}

LobbyMessage {
  id: string
  lobbyId: string
  fromAgentId: string
  toAgentId?: string
  type: "finding" | "handoff" | "blocker" | "completion" | "request" | "system"
  content: string
  createdAt: string
  signature?: string
}
```

### Lobby Capabilities

Plan for:

- Create lobby.
- Join lobby.
- Leave lobby.
- List roster.
- Send messages.
- Broadcast messages.
- Appoint boss agent.
- Hand raise.
- Floor control.
- Task creation.
- Task handoff.
- Agent identity verification.
- Invite / allowlist.
- Public/private switch.
- Session persistence.
- Abuse controls for public lobbies.
- Event log.

### Security Requirements

- Never expose private keys to the lobby.
- Do not store raw secrets in lobby messages.
- Private lobbies must deny unverified or unauthorized agents.
- Public lobbies should rate-limit joins and messages.
- Lobby messages should be scoped to a lobby.
- Boss-agent controls must be enforced server-side.
- Agent display names are not identity; registry verification is separate.
- Identity status must be visible in the panel.

---

## 11. Concordium Agent Registry Integration

Use Concordium Agent Registry as the accountability anchor for private lobbies.

### Design Target

Private lobbies should be able to require that a joining agent has a verified Agent Registry identity. The agent identity should be linked to the human or later organizational identity behind it, without exposing unnecessary private information to other lobby participants.

### Claude Must Verify

Before implementation, Claude must read the current Concordium docs:

- Agent Registry reference.
- CIS-8004 Agent Registry.
- CIS-8 External Key Registry.
- Agent Card format.
- MCP service.
- Indexer.
- Concordium JavaScript SDK.
- Wallet / identity flow as needed.

### Initial Flow

1. User creates or selects an agent profile locally.
2. Identity Agent helps generate an Agent Card draft.
3. User registers or references the agent in Concordium Agent Registry.
4. Agent OS stores only non-secret registry references locally.
5. When joining a private lobby, the agent presents its registry reference.
6. Lobby verifies the registry reference using the indexer or registry service.
7. Lobby applies access policy:
   - no registry required
   - any registered agent
   - allowlisted registered agent
   - registered agent with verified human link
   - future: registered agent with organization link
8. Lobby shows identity status in roster:
   - unverified
   - registry verified
   - human-linked
   - organization-linked
   - failed

### Agent Card Considerations

Claude should plan an Agent Card schema that includes:

- agent name
- agent description
- capabilities
- runtime
- owner policy
- public contact or support URL, optional
- supported protocols
- allowed scopes
- current version
- created / updated timestamps
- hashable content for registry integrity
- no secrets

### Important Privacy Principle

The goal is accountability, not doxxing. Private lobbies should be able to verify that an agent is linked to a verified account or approved owner without necessarily exposing the human identity to every participant.

---

## 12. Runtime Adapter Layer

The current relay supports Claude CLI. The independent platform should use a stable adapter interface so more runtimes can be added.

### Target Runtimes

Plan adapters for:

- Claude CLI / Claude Code.
- OpenAI Codex CLI.
- OpenCode.
- Hermes Agent.
- OpenClaw.
- Cursor CLI.
- Generic API provider using OpenAI-compatible API.
- Generic API provider using Anthropic-compatible API.

### Adapter Strategy

Do not hardcode runtime logic throughout the panel or lobby. Introduce a runtime adapter contract.

Example:

```ts
interface AgentRuntimeAdapter {
  id: string
  label: string
  detect(): Promise<RuntimeDetectionResult>
  startAgent(config: StartAgentConfig): Promise<AgentProcessHandle>
  stopAgent(handle: AgentProcessHandle): Promise<void>
  sendInput(handle: AgentProcessHandle, message: RuntimeMessage): Promise<void>
  readOutput(handle: AgentProcessHandle): AsyncIterable<RuntimeEvent>
  supportsInteractiveMode: boolean
  supportsHeadlessMode: boolean
  supportsJsonOutput?: boolean
  supportsSessionResume?: boolean
  supportsMcp?: boolean
}
```

### First Implementation Priority

1. Preserve Claude CLI adapter compatibility.
2. Extract current relay assumptions into a `claude-cli` adapter.
3. Add a runtime detection screen in Agent OS Panel.
4. Add adapter registry configuration.
5. Add Codex CLI adapter as first new CLI adapter.
6. Add OpenCode adapter.
7. Add Cursor adapter.
8. Add Hermes and OpenClaw adapters after a discovery spike.
9. Add generic API provider adapters.

### Adapter Discovery Spike

For each runtime, Claude must document:

- Installation command.
- Authentication model.
- How to start an interactive or headless session.
- Whether stdin/stdout can be controlled reliably.
- Whether JSON/NDJSON output is supported.
- Whether sessions can be resumed.
- Whether MCP is supported.
- How to pass project root.
- How to pass system or instruction files.
- How to restrict file access.
- How to stop/cancel safely.
- Known security concerns.

### Adapter Acceptance Criteria

- Runtime adapters are feature-flagged.
- If a runtime is not installed, the panel explains how to install it.
- Failure of one adapter does not break the panel.
- The relay protocol remains stable.
- Local mode and swarm mode work with at least Claude CLI after refactor.
- Other adapters can be added without rewriting the lobby.

---

## 13. API-Based Agent Fuel

Not every user will run a CLI. Add a future-proof API provider layer.

### Provider Types

Support:

- OpenAI-compatible chat/completions or responses-style APIs.
- Anthropic-compatible message APIs.
- Local model providers with OpenAI-compatible endpoints.
- Hosted provider gateways.

### BYOK

Use bring-your-own-key by default.

Requirements:

- Keys stored locally or in the user's configured secret store.
- No keys sent to public lobby unless explicitly required and clearly disclosed.
- Provider configuration per local installation.
- Optional per-agent provider selection.
- Cost and token usage logging where available.
- Rate-limit handling.
- Model capability metadata:
  - tool use
  - function calling
  - context length
  - streaming
  - JSON mode
  - vision
  - code execution, if any

### Provider Adapter Contract

Plan a `ModelProviderAdapter` separate from `AgentRuntimeAdapter`.

```ts
interface ModelProviderAdapter {
  id: string
  label: string
  configure(config: ProviderConfig): Promise<void>
  complete(request: AgentCompletionRequest): Promise<AgentCompletionResult>
  stream(request: AgentCompletionRequest): AsyncIterable<AgentCompletionEvent>
  validateConfig(config: ProviderConfig): Promise<ProviderValidationResult>
}
```

---

## 14. Agent OS UI Assist Integration

The new platform should make UI Assist embeddable into any user project.

### Goal

Create an Agent OS UI Assist integration path that helps developers add the UI Assist overlay into their own apps and connect it to their local Agent OS Panel, local relay, or remote lobby.

### Required Planning Items

Claude should plan:

- A neutral UI Assist package.
- An integration agent that can inspect target project type.
- Framework adapters:
  - plain JS
  - React
  - Next.js
  - Vue
  - Svelte
  - Laravel / Blade
  - WordPress
  - Joomla
- Embed script or component model.
- Secure connection to local panel / relay.
- Optional remote lobby connection.
- Theming.
- Event contract.
- Task creation from UI.
- Chat bridge.
- Session restore.
- File and route awareness where allowed by user.
- Safety boundaries so UI Assist cannot edit a project without explicit permission.

### Suggested Package Shape

```text
packages/
  ui-assist-core/
  ui-assist-react/
  ui-assist-next/
  ui-assist-vue/
  ui-assist-embed/
```

---

## 15. Documentation and Onboarding

The independent repo must be easy to understand for developers who never saw AesirX ComplianceOne.

### Required Docs

Plan new or revised docs:

```text
README.md
CLAUDE.md
planning.md
docs/
  getting-started.md
  architecture.md
  local-mode.md
  swarm-mode.md
  lobby-hosting.md
  agent-identity.md
  concordium-agent-registry.md
  runtime-adapters.md
  training-agents.md
  ui-assist-integration.md
  security.md
  migration-from-complianceone.md
```

### README Must Explain

- What Agent OS Protocol is.
- Why scoped agents matter.
- Local mode.
- Swarm mode.
- Agent OS Panel.
- Relay.
- UI Assist.
- Training agents.
- Private lobbies and identity.
- Supported runtimes.
- Installation.
- Quick start.
- Safety model.
- Roadmap.

---

## 16. Suggested Repository Structure

Claude should inspect the actual repository before proposing changes, but the target structure may look like:

```text
agent-os-protocol/
  README.md
  CLAUDE.md
  planning.md
  package.json
  agent-os/
    RULES.md
    SPRINTS.md
    SUB-AGENTS.md
    ARCHITECTURE.md
    MEMORY.md
    LOBBY-PROTOCOL.md
    UI-ASSIST.md
    sub-agents/
    memories/
    scripts/
  agent-os-panel/
    index.html
    app.js
    styles.css
    tabs/
    presets.json
  apps/
    lobby-web/
  packages/
    protocol-core/
    lobby-client/
    lobby-server/
    relay/
    adapters/
      claude-cli/
      codex-cli/
      opencode/
      cursor-cli/
      hermes-agent/
      openclaw/
      openai-compatible/
      anthropic-compatible/
    identity-concordium/
    ui-assist-core/
    ui-assist-embed/
  docs/
  scripts/
  shared-memory/
  observations/
```

If the existing repo is simpler, do not over-engineer the first pass. Preserve working local panel functionality first.

---

## 17. Implementation Phases

Claude should turn this into a final sprint plan. Suggested phases follow.

### Phase 0 — Discovery, Safety, and Repo Confirmation

Deliverables:

- Confirm active repo.
- Confirm no changes to `grc-suite`.
- Inventory files and packages.
- Identify current relay entry points.
- Identify current panel server entry points.
- Identify all ComplianceOne/AesirX references.
- Identify dependencies and package scripts.
- Create initial risk list.

Exit criteria:

- Written repo inventory.
- Written grep report.
- Written final implementation plan.
- No implementation changes except planning docs.

### Phase 1 — Repository Isolation and Branding Neutralization

Deliverables:

- Replace product-specific branding with Agent OS Protocol naming.
- Replace ComplianceOne staging URLs with configurable lobby URL.
- Add `.env.example`.
- Add `AGENT_OS_LOBBY_URL`.
- Add safe defaults for local mode.
- Create `MIGRATION.md` for historical notes if needed.

Exit criteria:

- No runtime references to AesirX/ComplianceOne.
- Local panel still starts.
- Existing Claude relay still works.

### Phase 2 — Generic Agent Roster and Domain Specialist Model

Deliverables:

- Retire or convert ComplianceOne-specific agents.
- Add generic Domain Specialist Agent.
- Add Identity Agent.
- Add Runtime Adapter Agent.
- Add UI Assist Integration Agent.
- Add Training Agent.
- Update routing tables.
- Update presets.
- Update docs.

Exit criteria:

- Agent list is project-neutral.
- Presets work.
- No default agent contains AesirX-specific memories or instructions.

### Phase 3 — Training Command Design and First Implementation

Deliverables:

- `/train [agent]` command plan.
- Training inbox/review/activation structure.
- Skill draft generator.
- Source metadata.
- Dry-run mode.
- Secret detection.
- Training pack activation/deactivation.

Exit criteria:

- Claude can dry-run training.
- Claude can create reviewable skill drafts.
- Training does not modify core rules without explicit approval.

### Phase 4 — Runtime Adapter Abstraction

Deliverables:

- Extract Claude CLI assumptions into adapter layer.
- Runtime detection.
- Adapter registry.
- Panel runtime selector or status view.
- Preserve existing Claude CLI flow.

Exit criteria:

- Claude CLI works through adapter.
- Relay protocol remains stable.
- Adapter docs exist.

### Phase 5 — Add New CLI Adapter Plans / Spikes

Deliverables:

- Codex CLI discovery and adapter plan.
- OpenCode discovery and adapter plan.
- Cursor CLI discovery and adapter plan.
- Hermes Agent discovery and adapter plan.
- OpenClaw discovery and adapter plan.
- Compatibility matrix.

Exit criteria:

- At least one additional runtime has a working proof-of-concept, preferably Codex CLI.
- Others have documented implementation plans and blockers.

### Phase 6 — API Provider Adapter Layer

Deliverables:

- OpenAI-compatible provider adapter.
- Anthropic-compatible provider adapter.
- BYOK configuration.
- Provider validation.
- Per-agent provider selection plan.
- Streaming support where possible.

Exit criteria:

- API provider can fuel a generic agent in local mode.
- Secrets are never sent to lobby.

### Phase 7 — Independent Lobby Platform

Deliverables:

- New lobby protocol docs.
- Lobby API schemas.
- Public/private lobby flows.
- Durable state plan.
- Vercel deployment plan with WebSocket beta considerations.
- Fallback Node server option.
- Panel connection to new lobby URL.

Exit criteria:

- Panel can connect to new lobby endpoint.
- Local mode remains intact.
- Remote roster works.
- Messages are scoped to lobby.
- Boss agent floor control enforced server-side.

### Phase 8 — Concordium Agent Registry Integration

Deliverables:

- Identity Agent workflows.
- Agent Card draft schema.
- Registry reference storage.
- Registry verification plan.
- Private lobby access policies.
- UI indicators for identity status.
- Docs for setup and limitations.

Exit criteria:

- A lobby can require registered agent identity.
- Agent registry reference can be verified or marked failed.
- Private keys are never stored or transmitted by Agent OS.

### Phase 9 — UI Assist Integration Package

Deliverables:

- Product-neutral UI Assist docs.
- Embeddable package plan.
- Framework integration guides.
- Integration Agent instructions.
- Secure local/panel/lobby connection patterns.

Exit criteria:

- A developer can follow docs to add UI Assist to a basic project.
- UI Assist has no ComplianceOne-specific UI text.

### Phase 10 — Launch Readiness

Deliverables:

- Clean README.
- Install guide.
- Quick start.
- Examples.
- Security documentation.
- Adapter compatibility matrix.
- Lobby hosting guide.
- Public/private lobby guide.
- Training guide.
- First release tag plan.

Exit criteria:

- Fresh clone can run local mode.
- Fresh clone can connect to configured lobby.
- All tests and checks pass.
- No AesirX/ComplianceOne runtime references remain.
- No changes were made to `grc-suite`.

### Phase 12 — Agent OS Panel UI Redesign

Deliverables:

- CSS token system encoding DESIGN.md (the dark glass-panel control-plane aesthetic).
- Per-tab layout alignment to the `design-specs/` mockups (Agents, Lobby, Messages, Tasks, Gantt, Schedule, Memory).
- Logo/brand lockup and status indicators (agents, tasks, lobbies, identity).
- Styled Phase-8 identity badges folded into the design language.

Exit criteria:

- Each Panel tab visually matches its `design-specs/` mockup.
- DESIGN.md conventions are encoded as reusable CSS tokens.
- The panel still boots and all tabs work (no functional regression).

### Phase 13 — Agent OS Protocol Website

Deliverables:

- A simple static public website (`apps/website/`) reusing the DESIGN.md visual language.
- Landing page: hero, features, install/quick-start, docs + GitHub links, license.
- Local preview script; a hosted deploy is config-gated.

Exit criteria:

- The website serves locally and reflects current platform capabilities.
- Brand-neutral, Apache-2.0, with no domain content or secrets.

---

## 18. Testing and Verification

Claude must plan tests before implementation.

### Required Checks

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run agent-os-panel -- --no-relay
npm run agent-os-panel
```

Adjust commands to the actual repo scripts.

### Manual QA

Test:

- Panel opens.
- Local mode starts.
- Relay auto-starts.
- Agent starts and appears in roster.
- Messages tab updates.
- Tasks tab updates.
- Lobby tab shows local roster.
- Swarm mode accepts new lobby URL.
- Invalid lobby URL fails gracefully.
- Runtime adapter detection displays missing runtimes properly.
- Training dry-run does not write unexpected files.
- Private lobby identity failure is visible and understandable.

### Grep Gates

Run:

```bash
grep -RniE "AesirX|ComplianceOne|complianceone\.demo|grc-suite|Forseti" . \
  --exclude-dir=.git \
  --exclude-dir=node_modules
```

Run:

```bash
grep -RniE "PDPL|DPIA|TIA|MPS|DSR|DSAR|Vietnam|Decree" agent-os agent-os-panel docs packages apps \
  --exclude-dir=.git \
  --exclude-dir=node_modules
```

Any remaining matches must be justified as optional domain packs or historical notes.

---

## 19. Security Model

Claude must include these principles in the final plan.

### Local First

- Local mode must work without remote services.
- Secrets stay local by default.
- BYOK keys stay local.
- Agent training data stays local unless the user explicitly publishes it.

### Remote Lobby

- Remote lobby should coordinate agents, not own their secrets.
- Lobby should not receive raw provider API keys.
- Lobby should not receive private wallet keys.
- Lobby should not expose human identity unnecessarily.
- Lobby should store durable event logs for private accountability.
- Public lobby abuse controls are required.

### Identity

- Registry identity proves accountability and discoverability.
- Agent display names are not trust anchors.
- Verification state must be explicit.
- Human/organization link should be policy-driven and privacy-preserving.

---

## 20. Open Questions Claude Must Resolve During Final Planning

Claude should answer these in the final implementation plan after inspecting the repo:

1. Is the new repository currently a full copy of `agent-os/**`, `agent-os-panel/**`, scripts, and shared-memory, or only the panel?
2. Is the relay server still located in `scripts/relay-server.ts`, or has it moved?
3. Should the repo remain a simple Node project or become a workspace/monorepo?
4. Which runtime adapter should be first after Claude CLI: Codex CLI or OpenCode?
5. What is the minimal Vercel lobby implementation that can safely support testing?
6. Which durable store should be used first for lobby state?
7. What is the fastest safe path to registry verification: indexer API, MCP service, SDK, or direct contract query?
8. Should trained agent packs be committed by default, ignored by default, or separated into user-local storage?
9. Should UI Assist be shipped as an npm package immediately or first as a repo-local embeddable script?
10. What files must be preserved exactly to keep the existing local Claude CLI flow working?

---

## 21. Final Plan Output Required From Claude

Claude must produce a final plan with:

1. Repo confirmation and boundary check.
2. Current file inventory.
3. AesirX/ComplianceOne reference audit.
4. Proposed target architecture.
5. Phase-by-phase implementation plan.
6. Files to change per phase.
7. Files not to touch.
8. Runtime adapter compatibility matrix.
9. Lobby platform plan.
10. Concordium Agent Registry integration plan.
11. `/train [agent]` plan.
12. UI Assist integration plan.
13. Testing plan.
14. Risks and mitigations.
15. Exact first sprint recommendation.

Claude must not skip the repository boundary check.

---

## 22. Recommended First Sprint

Name:

```text
Sprint 0 — Independent Agent OS Protocol Planning and Boundary Lock
```

Scope:

- Confirm repo.
- Create final implementation plan.
- Audit current code.
- Identify all product-specific references.
- Document migration strategy.
- Do not perform full implementation.

Acceptance criteria:

- `planning.md` exists.
- Repo boundary is confirmed.
- `grc-suite` is untouched.
- ComplianceOne/AesirX grep audit is complete.
- Final implementation plan is ready for approval.

---

## 23. Reference URLs For Claude To Verify Before Implementation

Claude should verify current docs before implementing external integrations:

- Concordium Agent Registry: `https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/index.html`
- OpenAI Codex CLI: `https://developers.openai.com/codex/cli`
- OpenCode: `https://opencode.ai/docs/`
- Hermes Agent CLI reference: `https://hermes-agent.nousresearch.com/docs/reference/cli-commands`
- OpenClaw CLI reference: `https://docs.openclaw.ai/cli`
- Cursor CLI: `https://cursor.com/docs/cli/overview`
- Vercel WebSocket support: `https://vercel.com/changelog/websocket-support-is-now-in-public-beta`

---

## 24. Final Reminder To Claude

This project exists because Agent OS Protocol should become independent from AesirX ComplianceOne.

Do not damage the working ComplianceOne version.

Do not edit `grc-suite`.

Do not assume ComplianceOne product logic belongs in the independent platform.

Make the standalone Agent OS Protocol generic, trainable, runtime-flexible, and identity-aware.
