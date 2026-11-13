<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 R Digital -->

# Getting started on the hosted lobby (no local setup)

This guide is for **non-developers** who want to orchestrate agents from the online lobby without
running anything locally. If you're a developer running the panel on your own machine, you don't
need any of this — see [getting-started](getting-started.md); Local Mode keeps your keys on your
machine. For the design behind Hosted Mode, see [hosted-panel](hosted-panel.md).

You'll do four things: **create a Concordium wallet → sign in → add a model API key → issue Agent
IDs.**

## 1. Create a Concordium wallet + identity

Your wallet is your login — there are no passwords. Data you create is locked to it.

1. Install the **Concordium Wallet** (browser extension for desktop, or the mobile app) from
   <https://www.concordium.com/wallet>.
2. Create an account and complete **identity verification** with an identity provider (a one-time
   KYC step Concordium requires to create an on-chain identity). This gives you a Concordium
   **account address** and, when you issue Agent IDs, an on-chain **identity** to anchor them to.
3. Fund the account with a small amount of **CCD** only if you plan to submit your own on-chain
   transactions. Issuing an Agent ID through the registry can be **sponsored** (gasless) — see
   [training-agents](training-agents.md) and the registry docs — so most users need no CCD.

> Keep your recovery phrase safe and offline. Neither the lobby nor this project ever sees your
> private key or recovery phrase.

## 2. Sign in to the hosted lobby

1. Open the hosted lobby and click **Connect Wallet**.
2. The lobby shows a one-time challenge; approve the **signature request** in your wallet. This
   proves you control the wallet — nothing is spent.
3. You now have a short-lived **session**. Everything you configure is scoped to your wallet: only
   you can manage your lobby.

Under the hood this is `auth/nonce` → wallet signature → `auth/verify`, which returns a signed
session token. The token is unforgeable and expires; just reconnect your wallet when it does.

In the panel: **Manage → Hosted Mode → Sign in with wallet**.

Sign-in is verified against your account's **current on-chain credentials** (the server fetches
fresh account info from a Concordium node and checks the `signMessage` signature) — no keys are ever
trusted from the browser.

> **Operators:** point the server at gRPC nodes with `AGENT_OS_CONCORDIUM_NODE_MAINNET` /
> `AGENT_OS_CONCORDIUM_NODE_TESTNET` (defaults to the public nodes). The
> `AGENT_OS_DEV_TRUST_WALLET_SIGNATURES` bridge is legacy-path, demo-only, and the server refuses to
> start with it enabled in production.

## 3. Add your model provider API key

Agents need a model provider (e.g. Anthropic or OpenAI) key to run. In Hosted Mode you store it
**once, encrypted**, and the lobby uses it server-side — you never paste it per run. **There are no
platform spend limits; usage is billed by your own provider account**, so set limits there if you
want them.

You can set a key **for the whole lobby** (all its agents share it) or **override it for a single
agent**.

From the panel: **Manage → Provider Keys → Add key**, choose the provider, paste the key, and
(optionally) pick a specific agent. The panel only ever shows a masked hint (`••••1234`) afterward.

Or from the CLI (same wallet-gated API):

```bash
export AGENT_OS_LOBBY_URL="https://<your-lobby-host>"
export AGENT_OS_SESSION_TOKEN="<token from wallet sign-in>"

npm run config -- whoami     --lobby <lobby-id>
npm run config -- set-key    --lobby <lobby-id> --provider anthropic --key sk-ant-...
npm run config -- set-key    --lobby <lobby-id> --provider anthropic --key sk-ant-... --agent <agent-ref>   # per-agent override
npm run config -- list-keys  --lobby <lobby-id>
npm run config -- revoke-key --lobby <lobby-id> --id <key-id>
```

Keys are sent over TLS, sealed with AES-256-GCM at rest, and never returned in plaintext or written
to disk by the CLI.

## 4. Issue Agent IDs

Give each agent a verifiable on-chain identity (a `did:ccd:…`) from **Manage → Agents → Issue ID**.
Your wallet signs the Agent Card; the registry anchors it (sponsored/gasless where available). Once
an agent has an ID, it always connects to your lobby with that identity. See
[training-agents](training-agents.md) for what to do with your agents next.

---

## 5. Connect cloud workspaces

In **Apps**, set the hosted compute limits and enable workspace execution. Choose a provider, connect
your account, and verify the connection. The launch form lists the connected account's configured
profiles and regions. Choose a lobby task and a full commit SHA. Run history shows the result, budget
reservation, artifacts, and cleanup state.

Deployers configure each available provider profile as a JSON environment variable. Each profile
needs a trusted check `command` and a conservative `maxMicrosPerSecond` reservation rate based on the
provider plan. Commands must work with the configured network policy and guest image.

| Provider | Setup |
| --- | --- |
| E2B | Configure `AGENT_OS_E2B_PROFILE` for a private template. Connect an E2B API key. |
| Agent37 | Configure `AGENT_OS_AGENT37_PROFILE` for a plan with the approved private workspace endpoint. Connect an account API key. |
| Daytona | Set `AGENT_OS_DAYTONA_PROFILE` with `snapshot`, `region`, `isolation` (`container` or `vm`), `cpu`, `memoryMiB`, `diskMiB`, `maxRuntimeMs`, `maxMicrosPerSecond`, and `command`. Use a snapshot with Git, Bash, Python 3, and the check dependencies. The plan and target must return the requested sandbox class and confirm that outbound networking is blocked. |
| Modal | Set `AGENT_OS_MODAL_PROFILE` with `app`, `image`, `environment`, `region`, `isolation`, `cpu`, `memoryMiB`, `diskMiB`, `maxRuntimeMs`, `maxMicrosPerSecond`, and `command`. Provision the named app and image in the owner's Modal environment. Enter the token ID and secret separated by a colon. Confirm the plan supports the selected runtime and deny-network option. |
| Upstash Box | Set `AGENT_OS_UPSTASH_BOX_PROFILE` with `size` (`small`, `medium`, or `large`), `region` (`provider-managed`), `cpu`, `memoryMiB`, `diskMiB`, `maxRuntimeMs`, `maxMicrosPerSecond`, and `command`. Connect an Upstash Box API key. The service bills active CPU and the workspace budget reserves the configured ceiling while final usage is pending. |
| Vercel Sandbox | Run Node.js 22.19 or later and set `AGENT_OS_VERCEL_SANDBOX_PROFILE` with `region`, `cpu`, `diskMiB`, `maxRuntimeMs`, `maxMicrosPerSecond`, and `command`. Choose the project and its team in Apps. Use a Sandbox-authorized owner token for external hosting. For a Vercel-hosted lobby with project OIDC, set `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID` to the bound team and project and enable runtime `VERCEL_OIDC_TOKEN`. The existing project then appears as a selectable target. |

Vercel Deploy continues to use its own GitHub Actions secrets. Keep the Sandbox token scoped to the
intended team and project. Run a disposable task on each plan and region you enable, and confirm
cleanup in the provider dashboard before opening the profile to users.
