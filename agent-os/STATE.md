# STATE.md — Agent OS Protocol

> **Purpose:** Current implementation state of the independent platform. Informative, not
> normative. Updated as phases progress. The authoritative build plan is
> [`../IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md).
> **Last updated:** Phase 3.

## Status summary

The platform is being forked into an independent, Apache-2.0, product-neutral repository per
the 11-phase plan. **Phases 0–2 are merged to `main`; Phase 3 (`/train`) is landing.**

## Phase status

| Phase | Title | Status |
|------:|-------|--------|
| 0 | Discovery, safety, planning | ✅ complete |
| 1 | Repo isolation, branding & Apache-2.0 relicensing; runnable local mode | ✅ merged (#2) |
| 2 | Generic agent roster + Domain Specialist + new platform agents | ✅ merged (#3) |
| 3 | `/train [agent]` command | ✅ landing |
| 4 | Runtime adapter abstraction + canonical work-item schema | ⬜ planned |
| 5 | Additional CLI adapters (Codex first) | ⬜ planned |
| 6 | API provider (fuel) layer, BYOK | ⬜ planned |
| 7 | Independent lobby platform (public/private, durable state) | ⬜ planned |
| 8 | Concordium agent identity & verification | ⬜ planned |
| 9 | UI Assist integration package | ⬜ planned |
| 10 | Launch readiness | ⬜ planned |
| 11 | Loop / autonomous iterative execution | ⬜ planned |

## Done so far

- **Phase 1 — isolation + local mode (merged):** Apache-2.0 `LICENSE`/`NOTICE`, config, `.gitignore`,
  `MIGRATION.md`; the Panel UI + panel server/tray + relay extracted and de-branded (local types
  ported); governance docs neutralized; generic scripts/hooks + the scheduler engine kept.
  `npm run agent-os-panel` and the relay both boot.
- **Phase 2 — roster (merged):** 30-agent project-neutral roster (24 generic specialists + 6 new
  platform agents: domain-specialist, identity, lobby-architect, runtime-adapter,
  ui-assist-integration, training); 43 generic skills (ComplianceOne regulatory packs dropped);
  presets + routing updated. Panel discovers all 30.
- **Phase 3 — `/train` (landing):** `agent-os/scripts/train.mjs` engine + the `train` skill +
  `.claude/commands/train.md` + `npm run train`. Generates reviewable skill drafts with provenance,
  dry-run, **secret detection** (rejects keys/tokens/passwords/.env), explicit activation, and
  list/deactivate/remove. Writes confined to `training/` + `skills/trained/` + `memories/trained/`;
  never touches core rules. Verified end-to-end.

## Known follow-ups

- A deeper neutralization pass over inherited ComplianceOne prose still present in some governance
  docs (incident narratives, the i18n/`src/frontend` prompt-template bits in SUB-AGENTS.md) and the
  path references inside some kept agent definitions.
- `packages/` workspace structure (protocol-core, lobby, adapters, ui-assist) introduced from Phase 4.
