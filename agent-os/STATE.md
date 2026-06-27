# STATE.md — Agent OS Protocol

> **Purpose:** Current implementation state of the independent platform. Informative, not
> normative. Updated as phases progress. The authoritative build plan is
> [`../IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md).
> **Last updated:** Phase 1 in progress.

## Status summary

The platform is being forked into an independent, Apache-2.0, product-neutral repository per
the 11-phase plan. **Phase 0 (planning) is complete; Phase 1 (isolation, branding/copyright
neutralization, runnable local mode) is in progress.**

## Phase status

| Phase | Title | Status |
|------:|-------|--------|
| 0 | Discovery, safety, planning | ✅ complete |
| 1 | Repo isolation, branding & Apache-2.0 relicensing; runnable local mode | 🔄 in progress |
| 2 | Generic agent roster + Domain Specialist + new platform agents | ⬜ planned |
| 3 | `/train [agent]` command | ⬜ planned |
| 4 | Runtime adapter abstraction + canonical work-item schema | ⬜ planned |
| 5 | Additional CLI adapters (Codex first) | ⬜ planned |
| 6 | API provider (fuel) layer, BYOK | ⬜ planned |
| 7 | Independent lobby platform (public/private, durable state) | ⬜ planned |
| 8 | Concordium agent identity & verification | ⬜ planned |
| 9 | UI Assist integration package | ⬜ planned |
| 10 | Launch readiness | ⬜ planned |
| 11 | Loop / autonomous iterative execution | ⬜ planned |

## Done so far (Phase 1)

- **Licensing & config:** Apache-2.0 `LICENSE` + `NOTICE`; `package.json`; `.env.example`
  (`AGENT_OS_LOBBY_URL` etc.); `.gitignore` (runtime state regenerated, trained packs user-local);
  `MIGRATION.md` (provenance).
- **Local control plane extracted & de-branded:** the Panel UI (`agent-os-panel/`), panel server
  + tray (`agent-os/scripts/`), and the relay (`packages/relay/`) with its lobby types localized.
  **Verified:** `npm run agent-os-panel` boots and serves the UI + API; the relay boots, finds the
  Claude CLI, and listens on its WebSocket.
- **Governance docs extracted & neutralized:** RULES, SPRINTS, SUB-AGENTS, MEMORY, LOBBY-PROTOCOL,
  UI-ASSIST(+GUIDE), ETHICS, SOUL, HOUSEKEEPING, sprints-reference, whisper-rules; ARCHITECTURE
  rewritten fresh; product-only docs (REUSE, I18N) dropped.
- **Brand gate:** extracted code + governance docs are clean of product-specific references
  (the only matches are the planning/charter/migration docs that describe the fork).

## In progress / next (Phase 1)

- Generic scripts/hooks + the scheduler engine (copy + neutralize; drop product-specific ones).
- A deeper doc-hygiene refresh of inherited illustrative history in the governance docs.
- Then: open the Phase 1 PR.

## Known follow-ups

- Sub-agent roster transformation → Phase 2 (generic specialists + new platform agents:
  Identity, Lobby Architect, Runtime Adapter, UI Assist Integration, Training, Domain Specialist).
- `packages/` workspace structure (protocol-core, lobby, adapters, ui-assist) introduced from Phase 4.
