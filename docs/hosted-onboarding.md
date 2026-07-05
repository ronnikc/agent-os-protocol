<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen -->

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

> **Operators (beta):** production sign-in requires the Concordium ed25519 signature verifier (in
> progress). To demo on testnet before it lands, set `AGENT_OS_DEV_TRUST_WALLET_SIGNATURES=1` on the
> lobby server — it accepts wallet signatures without verification (loud warning, **never for
> production**).

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

**Recap:** wallet = your login; keys are stored encrypted and wallet-locked; per-lobby or per-agent;
no platform spend caps. Server-side agent execution (so agents run without any local machine) is the
next hosted milestone — see [hosted-panel](hosted-panel.md).
