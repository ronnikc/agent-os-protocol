// SPDX-License-Identifier: Apache-2.0
import {
  AccountAddress, CcdAmount, ContractAddress, Energy, Parameter, ReceiveName, ReturnValue,
  verifyAccountSignature, type AccountSigner, type ConcordiumGRPCClient, type ContractContext,
  type UpdateContractInput,
} from '@concordium/web-sdk';

const registry = ContractAddress.create(10082n, 0n);
const genesis = Buffer.from('9dd9ca4d19e9393877d2c44b70f89acbfc0883c2243e5eeaecc0d1cd0503f478', 'hex');
type RegistryReader = Pick<ConcordiumGRPCClient, 'invokeContract' | 'getConsensusStatus'>;
export interface AgentWalletBinding {
  wallet: AccountAddress.Type | null;
  nonce: bigint;
}

export interface PreparedWalletBinding {
  update: ContractContext;
  payload: UpdateContractInput;
  deadline: number;
  previousWallet: AccountAddress.Type | null;
  nonce: bigint;
}

function u64(value: bigint): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}

function serializeSignatures(signatures: Awaited<ReturnType<AccountSigner['sign']>>): Buffer {
  const credentials = Object.entries(signatures).sort(([a], [b]) => Number(a) - Number(b));
  const byte = (value: number) => {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error('Invalid signature index or count');
    return Buffer.from([value]);
  };
  return Buffer.concat([byte(credentials.length), ...credentials.flatMap(([credential, keys]) => {
    const entries = Object.entries(keys).sort(([a], [b]) => Number(a) - Number(b));
    return [byte(Number(credential)), byte(entries.length), ...entries.flatMap(([key, signature]) => {
      if (!/^[a-f\d]{128}$/i.test(signature)) throw new Error('Invalid Ed25519 signature');
      return [byte(Number(key)), byte(0), Buffer.from(signature, 'hex')];
    })];
  })]);
}

/** Read the address and its rotation nonce from the same finalized block. */
export async function readMainnetWalletBinding(node: RegistryReader, tokenId: bigint): Promise<AgentWalletBinding> {
  const consensus = await node.getConsensusStatus();
  if (String(consensus.genesisBlock) !== genesis.toString('hex')) {
    throw new Error('Wallet binding requires Concordium mainnet');
  }
  const parameter = Parameter.fromHexString(Buffer.concat([Buffer.from([8]), u64(tokenId)]).toString('hex'));
  async function read(entrypoint: string) {
    const result = await node.invokeContract({
      contract: registry, method: ReceiveName.fromString(`CIS-8004.${entrypoint}`), parameter,
    }, consensus.lastFinalizedBlock);
    if (result.tag !== 'success' || !result.returnValue) throw new Error(`Registry lookup failed: ${entrypoint}`);
    return Buffer.from(ReturnValue.toBuffer(result.returnValue));
  }
  const [walletResponse, nonceResponse] = await Promise.all([read('getAgentWallet'), read('getAgentWalletNonce')]);
  if (nonceResponse.length !== 9 || nonceResponse[0] !== 1) throw new Error('Unexpected registry wallet nonce encoding');
  let wallet: AccountAddress.Type | null;
  if (walletResponse.length === 1 && walletResponse[0] === 0) {
    wallet = null;
  } else if (walletResponse.length === 33 && walletResponse[0] === 1) {
    wallet = AccountAddress.fromBuffer(Uint8Array.from(walletResponse.subarray(1)).buffer);
  } else {
    throw new Error('Unexpected registry wallet address encoding');
  }
  return { wallet, nonce: nonceResponse.readBigUInt64LE(1) };
}

/** Prepare a binding or rotation for explicit owner approval. The payer signs the raw registry message. */
export async function preflightMainnetWalletBinding(
  node: RegistryReader & Pick<ConcordiumGRPCClient, 'getAccountInfo'>,
  tokenId: bigint,
  owner: AccountAddress.Type,
  payer: AccountAddress.Type,
  signRaw: AccountSigner['sign'],
  expectedWallet: AccountAddress.Type | null,
): Promise<PreparedWalletBinding> {
  const current = await readMainnetWalletBinding(node, tokenId);
  if (current.wallet?.address !== expectedWallet?.address) throw new Error('Current agent wallet changed; review the binding again');
  if (current.wallet?.address === payer.address) throw new Error('Agent wallet is already bound to this address');

  const token = u64(tokenId);
  const tokenParameter = Buffer.concat([Buffer.from([8]), token]);

  const deadline = Date.now() + 10 * 60_000;
  const deadlineBytes = u64(BigInt(deadline));
  const payerBytes = AccountAddress.toBuffer(payer);
  const message = Buffer.concat([
    Buffer.from('CIS-8004/v1/setAgentWallet'), token, AccountAddress.toBuffer(owner), payerBytes,
    u64(current.nonce), deadlineBytes, u64(registry.index), u64(registry.subindex), genesis,
  ]);
  const account = await node.getAccountInfo(payer);
  const signatures = await signRaw(Uint8Array.from(message).buffer);
  if (!await verifyAccountSignature(message, signatures, account)) throw new Error('Payer did not sign the raw registry message');
  const encoded = serializeSignatures(signatures);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(encoded.length);
  const update: ContractContext = {
    invoker: owner,
    contract: registry,
    method: ReceiveName.fromString('CIS-8004.setAgentWallet'),
    parameter: Parameter.fromHexString(Buffer.concat([tokenParameter, payerBytes, deadlineBytes, length, encoded]).toString('hex')),
    energy: Energy.create(100_000n),
  };
  const result = await node.invokeContract(update);
  if (result.tag !== 'success') throw new Error('Registry rejected the wallet binding simulation');
  const payload: UpdateContractInput = {
    address: registry,
    receiveName: update.method,
    message: update.parameter!,
    amount: CcdAmount.fromMicroCcd(0),
    maxContractExecutionEnergy: Energy.create(100_000n),
  };
  return { update, payload, deadline, previousWallet: current.wallet, nonce: current.nonce };
}
