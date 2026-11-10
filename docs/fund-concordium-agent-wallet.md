# Fund a dedicated Concordium agent account

This guide covers wallet setup and ordinary funding transfers. Agent OS payment execution remains gated until the x401 and x402 release checks pass.

## Create the accounts

1. Install [Concordium Wallet or Wallet for Web](https://docs.concordium.com/en/mainnet/docs/guides/deciding-wallet.html), complete the identity provider flow, and back up the wallet using the wallet's own recovery steps.
2. Use your main human account to hold the funds you plan to allocate. In the wallet, create a separate account for the agent under an eligible Concordium identity. Give it a recognizable name and copy its **Receive** address.
3. Verify that both accounts use the same network. An Agent ID is a registry identifier. Use the dedicated account's Concordium address as the transfer destination.
4. Before enabling agent spending, verify the dedicated payment address against the agent's registry record. The address shown by the registry may initially be the owner's account. Use a separate account and confirm its finalized binding before deploying a signer.

See the official [Wallet for Web setup](https://docs.concordium.com/en/mainnet/docs/browser-wallet/setup-browser-wallet.html) and [Concordium Agent Registry reference](https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/cis-8004.html).

## Prepare a mainnet binding or rotation

Pause the existing signer and reconcile outstanding payments before rotating. Find the registry token number in the Agent ID Card. Read the current wallet and nonce from the finalized chain:

```text
npm run agent-wallet-binding -- read TOKEN
```

Prepare the change using a local export of the dedicated **new payer** account. The payer signs the registry proof. The registry owner separately authorizes the contract transaction. On Windows PowerShell, set the four values below to the accounts and token you reviewed:

```powershell
$token = 'TOKEN'
$owner = 'OWNER_ADDRESS'
$current = 'CURRENT_WALLET_ADDRESS'
$payer = 'NEW_PAYER_ADDRESS'
$parameter = Join-Path $env:TEMP ('agent-wallet-' + [guid]::NewGuid() + '.bin')
Get-Content -LiteralPath $payerExportPath -Raw |
  npm run agent-wallet-binding -- prepare $token $owner $current $payer $parameter
```

Set `$payerExportPath` to the local account export path. Use `none` for the current address only when the registry read returns `null`. Keep the export out of Git. The preparation command checks mainnet, matches the current binding, verifies the payer signature, and simulates the update as the owner. It writes a new binary parameter file and prints the addresses and proof expiry for review.

The owner can submit the prepared parameter using an owner account configured in `concordium-client`. Review the account, network, fee, and proof deadline before approving:

```powershell
concordium-client contract update 10082 --entrypoint setAgentWallet --parameter-bin $parameter --sender $owner --energy 110000 --grpc-ip grpc.mainnet.concordium.software --grpc-port 20000 --secure
```

Wait for finalization and run the read command again. Confirm the new address and increased nonce before enabling the new signer. A failed, expired, or superseded proof requires a fresh read and preparation. The browser panel does not yet prepare the raw payer proof. The current CLI is an operator workflow. [CIS-8004 wallet binding specification](https://proposals.concordium.com/CIS/cis-8004.html#setagentwallet)

## Get CCD into the main human account

- For mainnet, choose a provider listed in the [Concordium CCD directory](https://www.concordium.com/ccd-token) that serves your region. The wallet may also show a **Buy** option. Provider availability, minimum amounts, and fees vary.
- Use the human wallet's **Receive** address and select the native Concordium network on the onramp or exchange. Verify the address before confirming the purchase or withdrawal.
- Start with a small amount. Wait for the transaction to finalize, then check the balance in the wallet and the transaction in the explorer.
- For testnet, follow the official [wallet testnet funding instructions](https://docs.concordium.com/en/mainnet/technical-reference/wallets/guides/send-ccd-wallets.html). Testnet and mainnet balances are separate.

## Transfer a limited amount to the agent

1. In the human wallet, select **Send**, paste the agent's receive address, and enter a small amount of CCD. Check the network, destination, amount, and fee before signing.
2. Keep enough CCD in the human account to pay the normal transfer fee. After confirmation, check the agent account balance and save the finalized transaction ID.
3. For an x402 quote in **CCD**, the agent needs the quoted amount of native CCD. The approved facilitator sponsors the fee when the quote uses Concordium's sponsored exact scheme. For an x402 quote in a **protocol-level token**, acquire and transfer that exact token instead. Check the token ID, network, issuer restrictions, and recipient eligibility.
4. Set the agent's payment limit below the amount you are prepared to allocate. Keep the agent disabled until the signer, recipient, sponsor, asset, and per-period limits have been reviewed.
5. Reconcile the first charge with the agent balance and the finalized receipt. If the outcome is uncertain, look up the original transaction before making another payment. Pause the signer before changing an Agent ID binding or payment account.

See the [official CCD transfer guide](https://docs.concordium.com/en/mainnet/technical-reference/wallets/guides/send-ccd-wallets.html) and [Concordium x402 exact payment scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_concordium.md).
