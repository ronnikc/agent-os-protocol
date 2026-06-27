# SUB-AGENTS — Agent OS Protocol Sub-Agent System

> **Last updated:** Phase 2 (independent platform — 30-agent roster: 24 generic specialists + 6 platform agents)
> **Purpose:** Sub-agent orchestration system — agent roster, routing rules, parallelism constraints, crash prevention, prompt template, verification rules, and common error patterns.
> **When to update:**
> - New sub-agent type added or retired
> - Parallelism or context management rules change
> - Crash prevention strategy updated
> - Routing rules refined
> - New agent error patterns discovered (add to Common Agent Errors)
>
> **Precedence:** See CLAUDE.md → Precedence / Conflict Resolution.

> **Companion files:**
> - **[sub-agents/README.md](sub-agents/README.md)** — Full agent index with definitions, skills, and memories
> - **[sub-agents/skills/README.md](sub-agents/skills/README.md)** — Skill index (shared and agent-specific)
> - **[sub-agents/memories/README.md](sub-agents/memories/README.md)** — Sub-agent memory index
> - **CLAUDE.md** — Repo structure, build commands, code patterns
> - **MEMORY.md** — Root memory (non-negotiables)

---

## System Overview

The sub-agent system provides specialized agents that can be delegated tasks via the Agent tool. Each agent has:

1. **Definition file** — Role, owned docs/source, skills to load, startup instructions (`sub-agents/agents/`)
2. **Skills** — Reusable capability modules the agent loads for specific task types (`sub-agents/skills/`)
3. **Memories** — Learned lessons and evolved patterns specific to the agent's domain (`sub-agents/memories/`)

### Design principles

- **Spec-driven.** Every agent reads its owned specs before writing code.
- **Minimal context.** Agents load only what they need — definition + relevant skills + relevant memories. Never dump entire docs trees.
- **Learn and evolve.** After each sprint, update agent memories with lessons learned so quality improves over time.
- **Fail safely.** Agents that hit limits return partial results rather than crashing the session.

---

## Agent Roster

### Core Engineering (9)

| Agent | Slug | Focus | Docs Owned | Source Owned |
|-------|------|-------|------------|--------------|
| **Planning Specialist** | `planning` | Sprint planning, work breakdown, task decomposition | docs | N/A |
| **Research Specialist** | `research` | Codebase research, spec analysis, impact assessment | All (read-only) | All (read-only) |
| **Backend Specialist** | `backend` | API, data model, services, workspace isolation | docs | the backend |
| **Frontend Specialist** | `frontend` | UI components, user flows, web UI | docs | the frontend |
| **API Specialist** | `api` | API contracts, endpoint design, payload validation | the API-contract docs | the backend modules |
| **Test Specialist** | `test` | Unit/integration/E2E tests, coverage, mocks | `docs/testing/` | the tests |
| **Code Review Specialist** | `code-review` | Code quality, pattern compliance, security review | `docs/engineering/` | Throughout |
| **Build Integrity Specialist** | `build-integrity` | Build health, TypeScript compilation, dependency resolution, zero-tolerance for pre-existing errors | Build configs, `package.json` files | All `tsconfig.json`, all `package.json` |
| **Graph Navigator** | `graph-navigator` | Dependency graph, blast radius, import chains, structural codebase intelligence | `agent-os/graph.json` | Read-only across `src/` |

### Security & Accessibility (2)

| Agent | Slug | Focus | Docs Owned | Source Owned |
|-------|------|-------|------------|--------------|
| **Security Specialist** | `security` | AuthN/AuthZ, access control, encryption, data classification | `docs/security/` | Throughout |
| **Accessibility Specialist** | `accessibility` | WCAG 2.1 AA, ARIA, keyboard nav, screen readers | `docs/accessibility/` | Throughout |

### Delivery & Infrastructure (3)

| Agent | Slug | Focus | Docs Owned | Source Owned |
|-------|------|-------|------------|--------------|
| **Documentation Specialist** | `documentation` | Release notes, user guides, API reference, training materials | `docs/` (all `.md` files) | N/A |
| **Release Specialist** | `release` | CI/CD, deployment, versioning, changelog | `docs/infrastructure/` | Project root configs |
| **Infrastructure Specialist** | `infrastructure` | Docker, monitoring, environments, storage | `docs/infrastructure/` | `docker-compose.yml`, CI configs |

### Coordination & Process (2)

| Agent | Slug | Focus | Docs Owned | Source Owned |
|-------|------|-------|------------|--------------|
| **Boss Agent** | `boss-agent` | Agent Lobby coordination, multi-session orchestration, work assignment, handoff management | `agent-os/sub-agents/agents/boss-agent.md` | `packages/lobby-server/`, `agent-os/scripts/lobby-*` |
| **Sprint Gate Enforcer** | `sprint-gate-enforcer` | Enforces sprint gates and completion checks before close-out | `SPRINTS.md` | `agent-os/scripts/sprint-gate-runner.sh` |

### Product & Validation (6)

| Agent | Slug | Focus | Docs Owned | Source Owned |
|-------|------|-------|------------|--------------|
| **Product Specialist** | `product` | Roadmap, feature specs, phase gates, sprint specs | `docs/product/` | N/A |
| **UX Specialist** | `ux` | User experience, interaction design, usability, user flows | docs | the frontend |
| **Design Specialist** | `design` | Visual design, component design, design system | docs | the frontend components |
| **UI Assist Specialist** | `ui-assist` | WebSocket relay, Claude Code integration, overlay | Sprint 17.8.0 spec | `src/*/modules/ui-assist/` |
| **User Validation Specialist** | `user-validation` | Persona and use case validation for sprint planning and acceptance criteria | `docs/user-validation/` | N/A (cross-cutting review) |
| **Product QA Specialist** | `product-qa` | Code-level production readiness review against personas and use cases. Reads every page, walks workflows, reports findings. | `docs/user-validation/` (read-only) | frontend pages (read-only) |

### Growth & Content (2)

| Agent | Slug | Focus | Docs Owned | Source Owned |
|-------|------|-------|------------|--------------|
| **Content Specialist** | `content` | Copy, docs, onboarding text | `docs/` | N/A |
| **SEO Specialist** | `seo` | Meta tags, structured data, page titles, crawlability | N/A | frontend meta/head |

### Platform (6)

| Agent | Slug | Focus | Docs Owned | Source Owned |
|-------|------|-------|------------|--------------|
| **Domain Specialist** | `domain-specialist` | Blank-slate trainable subject-matter expert; no built-in domain knowledge — taught via `/train` | trained skills/memory | `agent-os/sub-agents/skills/trained/`, `agent-os/memories/trained/` |
| **Identity Agent** | `identity` | Agent identity, Agent Card authoring, registry-reference verification (Concordium) | `docs/agent-identity.md` | `packages/identity-concordium/` |
| **Lobby Architect** | `lobby-architect` | Lobby protocol, WebSocket transport, floor control, durable state, access control | `LOBBY-PROTOCOL.md` | `packages/lobby-server/`, `apps/lobby-web/` |
| **Runtime Adapter Specialist** | `runtime-adapter` | Adapter contracts for CLI + API runtimes (Claude/Codex/OpenCode/Cursor/…) | `docs/runtime-adapters.md` | `packages/adapters/`, `packages/relay/` |
| **UI Assist Integration Specialist** | `ui-assist-integration` | Embed the UI Assist overlay into user apps; framework integrations | `docs/ui-assist-integration.md` | `packages/ui-assist-*/` |
| **Training Agent** | `training` | Owns `/train` — reviewable, reversible, secret-detecting skill+memory authoring | `docs/training-agents.md` | `agent-os/training/` |

---

## Agent Routing Rules

### 1. Single-focus tasks

Route to the owning agent. Examples:
- "Add a new API endpoint" → **Backend**
- "Fix failing test" → **Test**
- "Audit page for WCAG" → **Accessibility**
- "Create landing page or blog post" → **Agent OS Protocol Content Agent**
- "What files are affected by this change?" → **Graph Navigator**
- "What's the blast radius?" → **Graph Navigator**
- "Write/revise/audit help center articles" → **Help Center Content Specialist**
- "Review module for production readiness" → **Product QA Specialist**
- "Coordinate work across connected agent sessions" → **Boss Agent**
- "Agent Lobby, multi-session coordination, handoff" → **Boss Agent**
- "Is this module ready for real users?" → **Product QA Specialist**
- "Walk through this module as the DPO persona" → **Product QA Specialist**

### 2. Cross-cutting tasks (lead + reviewer pattern)

| Task type | Lead agent | Reviewer agents |
|-----------|-----------|----------------|
| New feature (full stack) | **Planning** decomposes → **Backend** + **Frontend** | **Security**, **Accessibility**, **Test** |
| API endpoint + frontend | **Backend** leads | **API** reviews contract, **Frontend** consumes |
| Security-sensitive change | **Security** leads | **Backend** or **Frontend** implements |
| Trainable domain pack | **Domain Specialist** leads | **Training** authors the pack, **User Validation** validates use cases |
| Sprint implementation | **Planning** breaks down | Route each task to owning agent; **User Validation** reviews acceptance criteria |
| Sprint validation / acceptance | **User Validation** leads | **Product** for acceptance criteria |
| Module production readiness review | **Product QA** leads | **User Validation** for persona/use case alignment, **Accessibility** for WCAG compliance |
| Sprint spec governance & linting | **Product** leads (Gate -2) | **Code Review** validates via `spec-linting` skill |
| Bug fix sprint | **Research** diagnoses | Owning agent fixes, **Test** verifies |
| Accessibility audit | **Accessibility** leads | **Frontend** implements fixes |
| Release preparation | **Release** leads | **Documentation**, **Test** |

### 2a. Graph Navigator — first choice for cross-file research (R-31)

**Before** spawning a `general-purpose`, `Explore`, `research`, or `code-review` agent for ANY of the questions below, you MUST run a `graph-navigator` query first. Graph navigator walks the pre-built `agent-os/graph.json` in ~5-10 tool calls; the alternatives do manual traversal in hundreds.

| Trigger question | Correct first move |
|---|---|
| "Where is symbol/function/component X used?" | `graph-navigator` |
| "What depends on file Y?" | `graph-navigator` |
| "What would break if I change Z?" (blast radius) | `graph-navigator` |
| "Which modules import from module M?" | `graph-navigator` |
| "What's the dependency chain from A to B?" | `graph-navigator` |
| "Show me every route that calls service S" | `graph-navigator` |
| "Which pages consume hook/context H?" | `graph-navigator` |
| "What files were touched by sprint N?" | `graph-navigator` (via graph history) |
| "Pre-sprint impact assessment" | `graph-navigator` |
| "Fix sprint / code review across unreviewed PRs" | `graph-navigator` — cluster by dependency neighbourhood, then route clusters to reviewers |

**Escape hatch:** if the graph genuinely doesn't cover the query (e.g., SCSS `@import`, Markdown cross-links, non-TS artifacts), include a one-line justification in your reply **before** falling back to Grep/Read: `"graph-navigator does not cover X — using Grep fallback"`. This makes the fallback auditable.

**Anti-pattern:** spawning 4 parallel `general-purpose` agents for a cross-module review where the underlying question is "what depends on these files?". That's a graph query in disguise, and the fan-out pattern is what burned ~300 tool calls in the 2026-04-11 retrospective.

### 3. Mandatory agent coordination triggers

When one agent's changes require another agent's involvement, these triggers are AUTOMATIC — not optional:

| Change type | Lead agent | Must coordinate with | Why |
|-------------|-----------|---------------------|-----|
| Backend service/route modification | Backend | **Test Specialist** reviews and updates service/route tests | Code changes without test updates pass tsc but fail vitest (Incident 14) |
| Frontend component modification | Frontend | **Test Specialist** updates component test mocks | Props/text changes invalidate existing mocks |
| Route response message change | Backend/API | **Test Specialist** greps for old strings and updates assertions | String literal changes are invisible to tsc (Incident 14) |
| Shared type modification | Backend/Frontend | **Test Specialist** verifies test factories match new type shape | Factory Zod validation catches mismatches |
| Any module modification | Any code agent | **Test Specialist** runs existing tests BEFORE modification to establish baseline | Prevents "I introduced a regression but never ran existing tests" |

### 4. Sprint implementation workflow

```
1. Planning Specialist → reads sprint spec → produces task breakdown
2. User Validation Specialist → validates sprint against personas and use cases (if domain/workflow sprint)
3. Each task → routed to owning agent (with explicit file lists)
4. Accessibility Specialist → reviews all UI changes
5. Test Specialist → verifies coverage thresholds
7. Product QA Specialist → reviews implementations for production readiness (after code, before close-out)
8. User Validation Specialist → validates acceptance criteria against use case outcomes
8. Code Review Specialist → final quality check
9. Documentation Specialist → release notes + doc updates
```

---

## Parallelism & Resource Management

### Hard limits

| Rule | Limit | Rationale |
|------|-------|-----------|
| Max parallel agents (large tasks) | **4** | Raised from 2 in Sprint 18.5.0 — see crash-prevention.md; 5+ causes context window exhaustion |
| Max parallel agents (small/read-only tasks) | **4** | Research/review agents that return summaries are lighter |
| Max file size for agent Write tool | **800 lines** | Larger files hit max_tokens in agent context |
| Max lines per Bash heredoc chunk | **300–500** | Prevents truncation in shell output |
| Agent prompt size | **< 2000 tokens** | Include only essential context; link to files, don't inline them |

### Task sizing rules

| Task size | Lines of code | Strategy |
|-----------|---------------|----------|
| Small | < 200 lines | Single agent, foreground |
| Medium | 200–800 lines | Single agent, foreground or background |
| Large | 800–2000 lines | Main context with Bash heredoc chunks |
| Very large | > 2000 lines | Split into multiple files or multiple commits |

### Background vs foreground

| Use foreground when | Use background when |
|--------------------|---------------------|
| You need the result before continuing | Research that informs but doesn't block |
| Agent modifies files you'll edit next | Independent documentation updates |
| Sequential dependency exists | Parallel test or lint runs |

---

## Crash Prevention Strategies

> Established after 4 crashes during Phase 11 (Sprints 12.5.0–13.0.0), including loss of 66/81 files in Sprint 12.9.0.

### Root causes identified

| Crash type | Cause | Prevention |
|------------|-------|------------|
| Context exhaustion | Too many parallel agents on large file tasks | Hard limit: max 4 parallel agents (raised from 2 in Sprint 18.5.0) |
| Token overflow | Agent writing files > 800 lines via Write tool | Use Bash heredoc chunks from main context |
| Session stall | Agent enters infinite retry loop on max_tokens | Set explicit timeouts; recover from `/tmp/claude-0/` |
| Memory pressure | Loading full doc trees into agent prompts | Only link to files; agent reads what it needs |

### Mandatory safeguards

1. **Checkpoint before large operations.** Before any operation touching > 10 files, commit current work. This creates a recovery point.

2. **Progressive file writing.** For files > 500 lines:
   - Write in chunks of 300–500 lines using Bash heredoc
   - Verify each chunk was written correctly before continuing
   - Never attempt a single Write of > 800 lines

3. **Agent output recovery.** If an agent crashes mid-task:
   - Check `/tmp/claude-0/` for partial output files
   - Resume from the last successful checkpoint
   - Do NOT re-launch the same large task — break it smaller

4. **Context window hygiene.** Keep the main session lean:
   - Delegate research and exploration to sub-agents (use Agent tool with `subagent_type: Explore`)
   - Summarize agent results in 5–10 lines, not full transcripts
   - Avoid reading large files (> 500 lines) in the main context unless editing them
   - For documentation-heavy sprints, process files sequentially, not in parallel

5. **Sprint-level batching.** For sprints touching many files (like Phase 11 accessibility):
   - Batch files into groups of 10–15
   - Complete and commit each batch before starting the next
   - If a batch fails, only that batch needs to be redone
   - Track progress in the TodoWrite tool so recovery knows where to resume

6. **Escalation protocol.** If the session shows signs of strain:
   - Agent responses becoming truncated → reduce to 1 agent at a time
   - Read tool returning partial content → commit and continue in a new session
   - Multiple tool failures in sequence → stop, commit, document progress, suggest new session

---

## Orchestrator Verification (Non-Negotiable)

> **Dual-layer verification:** Agents self-verify (Self-Verification Gate in prompt template below), AND the orchestrator (main session) re-verifies. Both layers are mandatory.

After every agent completes work, the **orchestrator** MUST:

1. **Check the agent's self-verification results** — if the agent didn't report tsc/vitest output, treat its work as unverified
2. **Re-run `tsc --noEmit`** on the relevant workspace — rebuild shared first (`npx tsc -p the shared packagetsconfig.json`), then check backend/frontend. Never rely on cached builds
3. **Re-run the FULL frontend test suite** (`cd the frontend && npx vitest run`) — NOT just affected test files. Running only specific files misses cross-module regressions. Mandatory before ANY commit (~2.5 min locally)
3B. **If backend files were modified** (services, routes, middleware): run `cd the backend && npx vitest run` (full backend suite, not just affected modules). Backend cross-module dependencies can be as dangerous as frontend ones — a service return type change can invalidate sibling service mocks.
4. **If backend routes were modified:** run `npx vitest run` on `__tests__/routes.test.ts` in EVERY module where route response strings changed — tsc does NOT catch test assertion mismatches (Incident 14)
5. **Spot-check type alignment** — for any new service method, verify the shared type definition includes ALL fields the service writes to MongoDB
6. **Never accept "pre-existing error" from agents** — verify independently via git blame (Incident 14)
7. **Never trust agent output without verification** — agents hallucinate method names, field names, and type shapes
8. **Never commit unverified agent output** — generate → verify → fix → commit

### Common Agent Errors (Based on Incidents)

Watch for these known failure modes:

- Missing fields in shared type definitions that the service actually writes (e.g., `created_by` in service but not in type)
- `_id as string` instead of `_id as unknown as string` (MongoDB ObjectId cast)
- `req.params.x` passed directly to service methods without `as string` narrowing
- Missing vitest imports (`vi`, `afterEach`, etc.) in test files
- i18n keys referenced in code but not added to locale files
- Backend route message changes without updating test assertions (e.g., `'System archived'` → `'system_archived'` but test still asserts old string) — Incident 14
- Variable renamed in `.map()` callback but old name still used in JSX body (e.g., `(name, idx)` → `(dayKey, idx)` but `{name}` still in template) — Incident 14
- Agent reports error as "pre-existing" without verification — always check git blame
- **i18n text changes without test mock updates** — when i18n agents change component text (hardcoded → `t.key`), tests with partial mocks break because the mock is missing the new keys. The I18N agent MUST update affected test mocks or coordinate with the Test Agent. (Incident 15: 13 test files, 27 failing tests across 6 modules)

### Memory Write-Back (Post-Sprint — Agent-Specific)

> **This is MANDATORY when sub-agents were spawned during the sprint.** Global memory write-back rules are in SPRINTS.md → Step E.

After each sprint that used sub-agents:
1. Update `sub-agents/memories/build-integrity-lessons.md` with new build integrity incidents
2. Update `sub-agents/skills/test-patterns/SKILL.md` if new mock patterns discovered
3. Update `sub-agents/memories/crash-prevention.md` with new crash incidents or parallelism problems
4. Update agent-specific domain memories (e.g., `domain-phase16.md`, `accessibility-phase11.md`)
5. Update agent definition files if startup protocol needs new steps
6. Update `sub-agents/memories/README.md` — bump dates for modified files
7. If no sub-agent lessons exist, explicitly confirm: "Sub-agents were used — no new agent-specific lessons to write back"

### Sub-Agent Verification Rules (Bug-Fix Sprints)

See [memories/engineering-bug-fix-discipline.md](memories/engineering-bug-fix-discipline.md) for the full bug-fix playbook. Key rules: never accept "already implemented" without proof, fix root causes not symptoms, verify field name contracts end-to-end.

---

## Agent Prompt Template

When spawning a sub-agent via the Agent tool, use this template. The orchestrator
prepends a **Diary** section sourced from `agent-os/sub-agents/<agent>/diary.md`
(Sprint 46.6.2) and a **Routed Diaries** section sourced from peer agents listed
in `agent-os/sub-agents/diary-routing.yaml` (Sprint 46.6.7). The combined L1
block (Diary + Routed Diaries) is capped at the 800-token L1 budget from
Sprint 46.6.0; oldest peer entries are truncated first, the agent's own diary
is never truncated. Use:

```bash
bash agent-os/scripts/render-spawn-prompt.sh <agent-slug>
```

to produce the rendered block. If the diary is the placeholder and there are no
peer diaries with content, the entire L1 block is omitted silently.

**Sprint 46.6.9 — runtime contract.** Any spawn path that constructs an agent
prompt (Sprint tab, UI Assist, manual `Agent` tool calls, scheduled boss-agent
runs) MUST query

```
GET /api/memory/spawn-prompt?agent=<slug>
```

on the panel server (default port 4800) and prepend the returned `prompt` field
verbatim to the spawned agent's system prompt. The endpoint shells out to
`render-spawn-prompt.sh`, so callers don't need bash access. When the panel
isn't running, fall back to invoking the script directly.

```
You are the [AGENT NAME] for Agent OS Protocol.

## Diary (your persistent recall — Sprint 46.6.2)
<!-- inject head -100 of agent-os/sub-agents/<agent>/diary.md here -->
<!-- if diary is placeholder, omit this entire section -->

## Routed Diaries (cross-agent context — Sprint 46.6.7)
<!-- inject peer diaries from diary-routing.yaml, oldest entries truncated first -->
<!-- if no peers configured (default) or all peers are placeholders, omit -->

## Your role
[1-2 sentence focus description]

## Craft discipline (every task)
- Plan briefly before tool calls fire. State assumptions if uncertain — don't pick silently.
- Minimum code. No abstractions, flexibility, configurability, or error handling that wasn't requested.
- Surgical scope: every changed line must trace to the user's request. No drive-by improvements (R-36).
- Define success in 1–2 lines before starting; verify against it before returning.

## Before starting (MANDATORY — do not skip)
1. Read your definition: sub-agents/agents/[slug].md
2. Read relevant skills: sub-agents/skills/[skill-name].md (only if task matches skill summary)
3. Read relevant memories: sub-agents/memories/[memory-name].md (only if topic matches)
   - For review, QA, validation, UX, testing, or compliance tasks: ALWAYS read sub-agents/memories/platform-mission-evidence-by-design.md — it defines WHY the platform exists
3a. Memory retrieval contract (MEMORY.md): scan `INDEX.aaak.jsonl` first by literal anchor. If the literal scan misses for paraphrase / synonym / different framing of the same concept AND `MEMORY_SEMANTIC_RECALL` is `on` or `byok`, run `bash agent-os/scripts/embeddings-recall.sh "<query>" --top 5` (add `--corpus index` or `--corpus diaries` to narrow). Open the returned `ref` files the same way you would after a literal hit. Only fall through to grep / Explore once both have been tried.
4. Read docs/engineering/README.md (for code tasks)
5. Read the ACTUAL source types for every interface you will use, mock, or test:
   - Read the shared types before referencing any type
   - Read the real service file before writing mocks or tests
   - Read the real route file before wiring new endpoints
   - NEVER guess field names, method names, or type shapes
6. Report your startup context (mandatory — include in your first response before starting work):
   - "Loaded memories: [list memory files read and incident count reviewed]"
   - "Key lessons for this task: [2-3 specific lessons from memories that apply]"
   - Do NOT start work until this report is submitted

## Task
[SPECIFIC TASK DESCRIPTION]

## Constraints
- Only modify files in your owned source directories
- Flag cross-domain changes for review by the appropriate specialist
- MongoDB _id fields require `as unknown as string` — never use `as string` directly
- Express req.params values are `string | string[]` — narrow with `as string`
- Every field you write to MongoDB MUST exist in the shared type definition

## Self-Verification Gate (BLOCKING — do not return without completing)
After writing ALL files, you MUST run these commands and fix any errors before returning:
1. npx tsc -p the shared packagetsconfig.json (if shared types were modified)
2. npx tsc -p the backendtsconfig.json --noEmit (if backend files were modified)
3. npx tsc -p the frontendtsconfig.json --noEmit (if frontend files were modified)
4. npx vitest run [specific test file] (if test files were written)
5. **FULL frontend test suite** (`cd the frontend && npx vitest run`) — MANDATORY, not optional. Do NOT run only affected test files. The full suite catches cross-file regressions that individual file runs miss. (~2.5 min locally — no valid reason to skip it. Incident 15: i18n text changes broke 13 test files across 6 modules, but only running individual files masked the scope.)
6. If i18n keys or component text were modified:
   a. Find ALL test files with partial i18n mocks (tests that define `t: { ... }` inline instead of using `shared.en`)
   b. For EACH component whose text changed, read the test mock and verify ALL `t.xxx.yyy.zzz` keys used in the component exist in the mock
   c. Update test assertions that reference old hardcoded text to match the new i18n values
   d. The I18N Specialist agent MUST coordinate with the Test Agent to update test mocks — i18n changes without test mock updates are a gate failure
7. If backend route response messages were modified (error codes, success messages, status strings):
   a. grep -rn "old_message_string" the backend modules for EVERY changed string
   b. Update ALL test assertions to match the new message strings
   c. npx vitest run the backend modules
8. If variables were renamed in .map() callbacks, destructuring, or loop bodies:
   a. Verify ALL references to the old variable name within the same scope are updated
   b. Never leave orphaned variable references — tsc will catch some but JSX interpolation of void/undefined may not error clearly
If ANY command fails, fix the errors and re-run. Do NOT return with "tsc should pass" or "tests should work."
Only return after ALL verification commands produce zero errors.

## Return Format
- Summary (<20 lines): files changed, tests added, coverage impact
- Self-verification results: exact tsc/vitest output (PASS with 0 errors, or what was fixed)
```

### Prompt size budget

| Section | Target tokens |
|---------|---------------|
| Role + setup instructions | 200 |
| File read instructions (paths only) | 100 |
| Task description | 300 |
| Constraints + expected output | 200 |
| **Total** | **< 800** |

Leave room for the agent to read files and accumulate context during execution. An 800-token prompt leaves ~90% of the agent's context for actual work.

---

## Context Window Management

### Main session strategy

The main session orchestrates — it does NOT do heavy lifting. Follow this pattern:

```
Main session responsibilities:
├── Read sprint spec (small file)
├── Delegate planning to Planning Specialist
├── Route tasks to specialist agents
├── Track progress via TodoWrite
├── Commit completed batches
├── Write summaries (not full content)
└── Handle user interaction

Sub-agent responsibilities:
├── Read owned specs and relevant skills
├── Implement assigned task
├── Write files (within size limits)
├── Return concise summary
└── Flag cross-domain concerns
```

### Token budget guidelines

| Activity | Approximate tokens | Strategy |
|----------|-------------------|----------|
| Reading a 500-line file | ~3000 | Do in agent if only agent needs it |
| Reading a 100-line file | ~600 | OK in main session if needed for routing |
| Agent summary return | ~200–500 | Keep summaries concise |
| Sprint spec | ~1000–2000 | Read in main, excerpt for agents |
| Full docs/engineering/README.md | ~5000 | Agent reads it; don't load in main |

---

## Memory System for Sub-Agents

Each sub-agent has access to shared memories and can accumulate domain-specific memories.

### Memory types

| Type | Location | Scope |
|------|----------|-------|
| **Global memories** | `memories/` | All agents (existing system) |
| **Sub-agent memories** | `sub-agents/memories/` | Specific agents or agent groups |

### When to create a sub-agent memory

- Agent made a mistake that should not be repeated
- A non-obvious pattern was discovered during task execution
- A quality gate specific to the agent's domain was established
- Cross-agent coordination produced a reusable workflow

### Memory file format

Every memory file must start with a summary block:

```markdown
Title: [Short descriptive title]
Keywords: [comma-separated for retrieval]
Agents: [which agents should read this — slugs or "all"]
Scope: [narrow description of when this applies]
Last updated: [date]

[5-line max summary — agent reads this to decide if the full file is relevant]

---

[Full content below the divider]
```

---

## Skill System for Sub-Agents

Skills are reusable capability modules that agents load when their task matches the skill's summary.

### Skill structure

```
sub-agents/skills/
  README.md              ← Skill index (scan this first)
  accessibility-audit.md ← Skill: WCAG compliance auditing
  i18n-batch.md          ← Skill: Batch translation processing
  seed-data.md           ← Skill: Database seed file creation
  ...
```

### Skill file format

Every skill file must start with a summary block:

```markdown
Title: [Skill name]
Keywords: [comma-separated for retrieval]
Agents: [which agents use this skill — slugs]
When to use: [1-2 sentence trigger condition]
Last updated: [date]

[3-5 line summary — agent reads this to decide if the skill applies to the current task]

---

[Full skill instructions below the divider]
```

### Skill loading protocol

1. Agent reads `sub-agents/skills/README.md` (index only)
2. Matches task against skill summaries
3. Loads only matching skills (max 2–3 per task to preserve context)
4. If no skills match, proceeds with definition file instructions only

---

## Evolving the System

### Adding a new agent

1. Create `sub-agents/agents/{slug}.md` with role, owned docs, owned source, startup instructions
2. Add to the roster table in this file
3. Add to `sub-agents/README.md` index
4. Consider what skills the agent needs — create or assign existing skills
5. Update routing rules if the agent changes task delegation patterns

### Adding a new skill

1. Create `sub-agents/skills/{skill-name}.md` with summary block and full instructions
2. Add to `sub-agents/skills/README.md` index
3. Update relevant agent definitions to reference the skill

### Recording a new memory

1. Create `sub-agents/memories/{memory-name}.md` with summary block
2. Add to `sub-agents/memories/README.md` index
3. Reference in relevant agent definition files

---

## Automatic Systems (No Agent Effort Required)

> **Added 2026-04-04 — Sprint 38.5.0**

These systems run via Claude Code hooks and do not require agent awareness or action:

- **Whisper rules injection** — 10 mandatory rules injected on every prompt via `UserPromptSubmit` hook. Agents do not need to read RULES.md manually — critical rules are always in context.
- **Observation capture** — every tool call is auto-classified (decision/change/discovery/gate-check) by `PostToolUse` hooks. Agents do not need to log their actions.
- **Graph intelligence** — when agents read sprint specs, dependency graph blast radius is injected automatically. When editing shared/ files, a warning is injected.
- **Context preservation** — session state (sprint, tasks, files) is saved before compaction and restored on SessionStart. Agents retain continuity across compaction events.
- **Shared memory bus** — agents can read/write state and send messages via `shared-mem-*.sh` scripts in `agent-os/scripts/`.

### Agent OS Panel

Sub-agents can be started, stopped, and monitored from the Agent OS Panel (`npm run agent-os-panel`). The panel deploys agents as Node.js processes (via relay-server.ts), NOT via Claude CLI directly. Multiple developers can each run the panel and connect to the same staging lobby — all agents appear in a unified roster with hostname-prefixed display names for disambiguation.

---

*Roster is being transformed for the independent Agent OS Protocol platform — generic specialists plus new platform agents (Identity, Lobby Architect, Runtime Adapter, UI Assist Integration, Training, Domain Specialist). See IMPLEMENTATION-PLAN.md §7.*
