// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import type { LobbyTask } from '@agent-os/protocol-core';

export interface SpecialistProfile {
  id: string;
  owner: string;
  agentDid: string;
  displayName: string;
  skills: string[];
  runtimes: string[];
  availability: string;
  workSamples: string[];
  status: 'published' | 'unpublished' | 'suspended';
  updatedAt: number;
}

export interface MarketplaceListing {
  id: string;
  buyer: string;
  version: number;
  status: 'draft' | 'open' | 'hired' | 'cancelled' | 'expired';
  title: string;
  deliverable: string;
  acceptanceChecks: string[];
  scope: string;
  deadline: number;
  quote: { amount: '0' };
}

export interface MarketplaceBid {
  id: string;
  listingId: string;
  listingVersion: number;
  version: number;
  specialist: string;
  profileId: string;
  agentId: string;
  status: 'submitted' | 'withdrawn' | 'selected' | 'declined';
  quote: { amount: '0' };
  turnaroundHours: number;
  prerequisites: string;
  assumptions: string;
  expiresAt: number;
  consent: { actor: string; at: number; digest: string };
}

export interface MarketplaceAgreement {
  id: string;
  assignmentId: string;
  listing: MarketplaceListing;
  bid: MarketplaceBid;
  buyerConsent: MarketplaceBid['consent'];
  handoff: { task: LobbyTask; status: 'pending' | 'dispatched' };
}

export interface MarketplaceState {
  profiles: SpecialistProfile[];
  listings: MarketplaceListing[];
  bids: MarketplaceBid[];
  agreements: MarketplaceAgreement[];
  audit: { actor: string; action: string; subject: string; at: number; authorization?: string }[];
}

export function emptyMarketplaceState(): MarketplaceState {
  return { profiles: [], listings: [], bids: [], agreements: [], audit: [] };
}
