#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftAgentCard, hashAgentCard, validateAgentCard } from '@agent-os/identity-concordium';

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
const name = opts.name || 'Developer Agent';
const role = opts.role || 'coder';
const description = opts.description || `Specialized agent running role: ${role}`;
const runtime = opts.runtime || 'Claude Code';

const cardDraft = draftAgentCard({
  name,
  description,
  runtime,
  capabilities: [role, 'pair-programming'],
  ownerPolicy: 'self',
});

const validation = validateAgentCard(cardDraft);
if (!validation.ok) {
  console.error(`[ERROR] Invalid agent card draft: ${validation.errors.join('; ')}`);
  process.exit(1);
}

const cardHash = hashAgentCard(cardDraft);
const outPath = resolve(process.cwd(), 'agent-card.json');
writeFileSync(outPath, JSON.stringify(cardDraft, null, 2), 'utf8');

console.log(`[SUCCESS] Agent Card drafted and saved to: ${outPath}`);
console.log(`[HASH] Deterministic Content Hash (SHA-256): ${cardHash}`);
