// SPDX-License-Identifier: Apache-2.0
import { readFileSync, writeFileSync } from 'node:fs';
import { AccountAddress, Parameter, buildAccountSigner, parseWallet } from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient } from '@concordium/web-sdk/nodejs';
import { credentials } from '@grpc/grpc-js';
import { preflightMainnetWalletBinding, readMainnetWalletBinding } from '@agent-os/concordium-commerce';

const [operation, token, ownerAddress, expectedAddress, payerAddress, output] = process.argv.slice(2);
const read = operation === 'read' && process.argv.length === 4;
const prepare = operation === 'prepare' && process.argv.length === 8;

async function main() {
  if ((!read && !prepare) || !/^\d{1,20}$/.test(token || '') || BigInt(token) > 0xffffffffffffffffn) {
    throw new Error('Usage: npm run agent-wallet-binding -- read TOKEN | prepare TOKEN OWNER CURRENT_OR_NONE PAYER OUTPUT_BIN');
  }
  const node = new ConcordiumGRPCNodeClient('grpc.mainnet.concordium.software', 20000, credentials.createSsl(), { timeout: 10_000 });
  const tokenId = BigInt(token);
  if (read) {
    const { wallet, nonce } = await readMainnetWalletBinding(node, tokenId);
    console.log(JSON.stringify({ token, wallet: wallet?.address ?? null, nonce: String(nonce) }));
    return;
  }
  if (process.stdin.isTTY) throw new Error('Pipe a dedicated payer account export to stdin.');
  const owner = AccountAddress.fromBase58(ownerAddress);
  const payer = AccountAddress.fromBase58(payerAddress);
  const expectedWallet = expectedAddress === 'none' ? null : AccountAddress.fromBase58(expectedAddress);
  let signer;
  try {
    const wallet = parseWallet(readFileSync(0, 'utf8').trim());
    if (wallet.value.address !== payer.address || wallet.environment.toLowerCase() !== 'mainnet') throw new Error();
    signer = buildAccountSigner(wallet);
  } catch {
    throw new Error('Expected a mainnet account export for the dedicated payer address.');
  }
  const { payload, deadline, nonce } = await preflightMainnetWalletBinding(node, tokenId, owner, payer, signer.sign, expectedWallet);
  writeFileSync(output, Buffer.from(Parameter.toHexString(payload.message), 'hex'), { flag: 'wx' });
  console.log(JSON.stringify({
    token, owner: owner.address, previousWallet: expectedWallet?.address ?? null, payer: payer.address,
    nonce: String(nonce), deadline: new Date(deadline).toISOString(), contract: [10082, 0],
    entrypoint: 'setAgentWallet', attachedMicroCcd: '0', parameterFile: output,
  }, null, 2));
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
