// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * Registration preparation — builds a **non-submitting** plan. Agent OS prepares everything the
 * owner needs to register their Agent Card (the canonical card + its content hash + the ordered
 * steps), but it never signs and never submits: the registry's builder tools return a sign-ready
 * payload that the owner's own wallet signs and broadcasts. On-chain writes are deferred (Phase 8),
 * and no private key ever enters this process.
 */

import {
  AGENT_CARD_MEDIA_TYPE,
  type AgentCard,
  type ConcordiumNetwork,
  type RegistrationPlan,
} from '@agent-os/protocol-core';
import { assertNoSecretsInCard, hashAgentCard, validateAgentCard } from './agent-card.js';

export interface PrepareRegistrationOptions {
  /** Target network (defaults to the card's ref network, else 'mainnet'). */
  network?: ConcordiumNetwork;
}

/**
 * Produce a wallet-side-only registration plan for a card. Throws if the card is invalid or appears
 * to contain a secret — a card about to be published must be clean.
 */
export function prepareRegistration(card: AgentCard, options: PrepareRegistrationOptions = {}): RegistrationPlan {
  const validation = validateAgentCard(card);
  if (!validation.ok) {
    throw new Error(`cannot prepare registration — invalid Agent Card: ${validation.errors.join('; ')}`);
  }
  assertNoSecretsInCard(card);

  const network = options.network ?? card.ref?.network ?? 'mainnet';
  const cardHash = hashAgentCard(card);

  const steps = [
    `Review the Agent Card "${card.name}" (v${card.version}) — content hash sha256:${cardHash}.`,
    `Open your Concordium wallet (or the registry MCP service) on ${network}.`,
    'Ask the registry to build the registration transaction for this card hash — it returns a sign-ready payload ({ hex, schema_json }); Agent OS does not build or hold it.',
    'Sign the payload in your wallet and submit it yourself. Agent OS never signs or submits.',
    'Once confirmed, copy the resulting DID back into Agent OS to link this profile to its reference.',
  ];

  return {
    card,
    mediaType: AGENT_CARD_MEDIA_TYPE,
    cardHash,
    registry: 'concordium',
    network,
    steps,
    walletSideOnly: true,
    notice:
      'Agent OS prepares this registration but never signs or submits it. Signing happens in your wallet; no private key is ever stored or transmitted by Agent OS.',
  };
}
