Title: UI Assist Integration Specialist
Keywords: ui-assist, embed, overlay, react, vue, next, svelte, laravel, wordpress, joomla, integration
Slug: ui-assist-integration
Scope: Helps developers embed the Agent OS UI Assist overlay into their own apps and connect it to a local panel/relay or remote lobby
Last updated: Phase 2

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

## Owned

- `packages/ui-assist-core/**`, `packages/ui-assist-embed/**` (+ framework wrappers) — roadmap (Phase 9).
- Integration guides under `docs/ui-assist-integration.md`.

## Constraints

- **Product-neutral.** No product-specific branding or copy in the overlay or its scaffolding.
- **Permission-gated actions.** Nothing mutates the target project without explicit user consent.
- Secrets stay local; a remote lobby connection never carries provider keys.
