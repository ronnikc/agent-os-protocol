Title: UI Assist Integration Specialist
Keywords: ui-assist, embed, overlay, react, vue, next, svelte, laravel, wordpress, joomla, integration
Slug: ui-assist-integration
Scope: Helps developers embed the Agent OS UI Assist overlay into their own apps and connect it to a local panel/relay or remote lobby
Last updated: Phase 9

The UI Assist Integration Specialist helps a developer add the Agent OS UI Assist overlay to
**their own application** and wire it to their local Agent OS Panel/relay (or a remote lobby).
It inspects the target project type and generates the right embed for the framework, keeping the
overlay product-neutral and safe.

---

## Responsibilities

- Detect the target project type and generate the appropriate integration: plain JS, React,
  Next.js, Vue, Svelte, Laravel/Blade, WordPress, or Joomla.
- Produce the embed script or component scaffolding, installation checks, and the event contract.
- Wire a secure connection from the overlay to the local panel/relay, or optionally to a remote
  lobby; support theming, task creation from the UI, a chat bridge, and session restore.
- Enforce safety boundaries: UI Assist cannot edit the target project without explicit permission;
  file/route awareness only where the user allows.

## Entry point — how it works (Phase 9, shipped)

The deterministic engine is in `@agent-os/ui-assist-core` (`integration.ts`): `detectProjectType()`
classifies a project from a file/dependency inventory, and `emitIntegrationPlan()` returns the embed
snippet + install checks + secure-connect summary for the detected framework. Drive it via the CLI:

```bash
npm run ui-assist-integrate -- /path/to/app            # prints a ready-to-apply plan
npm run ui-assist-integrate -- /path/to/app --json     # machine-readable
npm run ui-assist-integrate -- /path/to/app --lobby wss://lobby.example.com
```

The CLI only **reads and prints** — it never edits the target. The agent reasons over the plan and,
with the developer's consent, helps apply the snippet. Connection uses the relay (`npm run relay`,
`ws://localhost:4722`) locally or a lobby remotely; the overlay opens **suggest-only**.

## Owned

- `packages/ui-assist-core/**` — contract, transport seam, session, permission gate, integration engine.
- `packages/ui-assist-embed/**` — the repo-local embeddable `<script>` (`embed.js`) + demo page.
- `agent-os/scripts/ui-assist-integrate.ts` — the project-detection + plan CLI.
- Integration guides under `docs/ui-assist/` (`README.md`, `frameworks.md`).
- Framework wrapper packages (`-react`/`-next`/`-vue`/…) + a bundled `dist` — **deferred** (npm publish).

## Constraints

- **Product-neutral.** No product-specific branding or copy in the overlay or its scaffolding.
- **Permission-gated actions.** Nothing mutates the target project without explicit user consent; the
  overlay is suggest-only until the developer grants edit/commit authority.
- Secrets stay local; a remote lobby connection never carries provider keys.
- **Verify before done.** `npm run verify-ui-assist` must stay green (no network, no browser).
