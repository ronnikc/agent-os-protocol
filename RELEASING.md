<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen -->

# Releasing Agent OS Protocol

How a release is cut. The project versions the **repository as a whole** (a git tag); the internal
`@agent-os/*` workspace packages are not separately published yet (see _Deferred_ below).

## Versioning

- [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
- Pre-1.0, breaking changes may land in a `MINOR` bump; treat the API as evolving.
- The single source of truth for the current version is `package.json` `"version"`, and the top
  entry of [`CHANGELOG.md`](CHANGELOG.md) must match it (enforced by `npm run verify-launch`).

## Release checklist

1. **Land all work for the release on `main`** via PRs (never push to `main` directly).
2. **Update the version** in `package.json` (e.g. `0.1.0`).
3. **Update [`CHANGELOG.md`](CHANGELOG.md)** — move items out of `Unreleased` into a new dated
   version section whose number equals `package.json`'s version.
4. **Green the gates** from a clean tree:
   ```bash
   npm ci
   npx tsc -b
   npm run verify-all
   npm run smoke           # fresh clone boots Panel + Lobby + Relay end-to-end
   ```
   `verify-launch` also re-checks the brand/domain gates, license, and changelog↔version match.
5. **Merge** the release PR once green.
6. **Tag the merge commit** and push the tag:
   ```bash
   git checkout main && git pull
   git tag -a v0.1.0 -m "Agent OS Protocol v0.1.0"
   git push origin v0.1.0
   ```
7. **Publish release notes** on GitHub for the tag, using the matching `CHANGELOG.md` section.

> The tag points at the **merge commit on `main`**, not a feature-branch commit — so cut it after
> the release PR is merged.

Before opening the repository to the public, verify these flows on the release candidate:

- A fresh Windows and Linux checkout can boot the local panel and complete one task with a local
  agent. On a test lobby, repeat the task across the WebSocket and verify disconnect and reconnect.
- The live GitHub App can open a reviewable canary PR against the demo repository. Verify that
  guests cannot dispatch work or manage the lobby.
- On a wallet-enabled machine, create a disposable private lobby, activate a member, admit an agent
  with its registered DID, then revoke access and confirm that the connection closes and rejoin is
  denied. Check that the public roster's verification badges agree with the registry.
- Compare both deployments' `/health` revisions with the tested SHA. Check the Git history and
  public demo content for credentials, private workspace data, and references that need redaction.
  In particular, review the historical `lobby-store-db.json` before publishing the commit history.

Set `AGENT_OS_PUBLIC_LOBBY_OWNER` before deploying if the production lobby has no owner. Use the
operator's full Concordium wallet DID. A wallet already recorded as the owner retains control.

## What a release contains

A clone at a release tag runs **Local Mode** (`npm run agent-os-panel`), connects to a **lobby**
(`npm run lobby` / `--lobby` / `AGENT_OS_LOBBY_URL`), and passes `npm run verify-all` + `npm run
smoke` with no network, runtime, or API key required for the suites. See
[`docs/getting-started.md`](docs/getting-started.md).

## Deferred (infra-gated — not part of the tag yet)

These need external infrastructure that cannot be booted or verified in CI, and are tracked in
[`agent-os/STATE.md`](agent-os/STATE.md):

- **npm publishing** of the `@agent-os/*` packages and the bundled UI Assist framework wrappers
  (`-react`/`-next`/`-vue`/…) — needs a bundler + a registry.
- **Hosted swarm lobby** `apps/lobby-web` and its server are deployed through the SSH/PM2 workflow.
- **Live Concordium indexer** wiring and on-chain (wallet-side) registration.

When npm publishing is introduced, this file gains a per-package `npm version` + `npm publish
--access public` step and the packages drop `"private": true`.

---

Licensed under **Apache-2.0** · © 2026 Gothard.dk // Ronni K. Gothard Christiansen.
