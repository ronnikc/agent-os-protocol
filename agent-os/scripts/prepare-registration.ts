#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareRegistration, hashAgentCard } from '@agent-os/identity-concordium';

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      options[key] = val;
    }
  }
  return options;
}

const opts = parseArgs();
const network = opts.network || 'testnet';
let cardHash = opts['card-hash'];

if (!cardHash) {
  const cardPath = resolve(process.cwd(), 'agent-card.json');
  if (existsSync(cardPath)) {
    try {
      const card = JSON.parse(readFileSync(cardPath, 'utf8'));
      cardHash = hashAgentCard(card);
      console.log(`[INFO] Found agent-card.json in workspace. Hash: ${cardHash}`);
    } catch (err) {
      console.error(`[ERROR] Failed to parse agent-card.json: ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    console.error('[ERROR] No agent-card.json found and no --card-hash provided.');
    console.log('Usage: npm run prepare-registration -- --card-hash <hash> [--network <network>]');
    process.exit(1);
  }
}

console.log('\n--- CONCORDIUM REGISTRY REGISTRATION PLAN ---');
console.log(`Target Network: ${network}`);
console.log(`Agent Card Hash: ${cardHash}`);
console.log('\nSteps to complete registration:');
console.log('1. Open your Concordium Wallet or invoke the Concordium MCP service.');
console.log(`2. Build a mint/register transaction anchoring hash: ${cardHash} to CIS-8004.`);
console.log('3. Sign the transaction with your Concordium private key.');
console.log('4. Submit the transaction to the network.');
console.log('5. Once confirmed, copy your agent\'s unique DID (did:ccd:<network>:<id>).');
console.log('\n[NOTICE] Agent OS prepares this plan but never stores or transmits your keys.');
