// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { createHash, randomUUID } from 'node:crypto';
import type { LobbyTask } from '@agent-os/protocol-core';
import type { LobbyStore } from './store.js';
import type { MarketplaceAgreement, MarketplaceBid, MarketplaceListing, MarketplaceState, SpecialistProfile } from './marketplace-state.js';

export class MarketplaceError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

function field(value: unknown, label: string, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new MarketplaceError(`Enter ${label}.`, 400);
  return value.trim();
}

function fields(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new MarketplaceError(`Enter ${label}.`, 400);
  return value.map(item => field(item, label, 300));
}

/** CCD terms only. Recording a quote does not initiate payment. */
function quote(amount: unknown): { amount: string } {
  if (typeof amount !== 'string' || !/^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,6})?$/.test(amount)) {
    throw new MarketplaceError('Enter a CCD amount with up to six decimal places.', 400);
  }
  const [whole, fraction] = amount.split('.');
  const decimals = fraction?.replace(/0+$/, '');
  return { amount: decimals ? whole + '.' + decimals : whole };
}

function digest(listing: MarketplaceListing, bid: Omit<MarketplaceBid, 'consent' | 'status'>) {
  const { status: _status, ...terms } = listing;
  return createHash('sha256').update(JSON.stringify({ terms, bid })).digest('hex');
}

function activeListing(listing: MarketplaceListing, now = Date.now()): MarketplaceListing {
  return listing.status === 'open' && listing.deadline <= now ? { ...listing, status: 'expired' } : listing;
}

function log(state: MarketplaceState, actor: string, action: string, subject: string, authorization?: string) {
  state.audit.push({ actor, action, subject, authorization, at: Date.now() });
}

export class Marketplace {
  private readonly handoffs = new Map<string, Promise<MarketplaceAgreement>>();
  constructor(private readonly store: LobbyStore,
    private readonly verifyOwner: (did: string, owner: string) => Promise<boolean>,
    private readonly dispatch: (task: LobbyTask) => Promise<void>) {}

  async catalog(lobbyId: string, capability: string, runtime: string, offset: number, limit: number) {
    const candidates = this.store.readMarketplaceState(lobbyId).profiles.filter(profile => profile.status === 'published' &&
      (!capability || profile.skills.some(skill => skill.toLowerCase().includes(capability.toLowerCase()))) &&
      (!runtime || profile.runtimes.some(value => value.toLowerCase() === runtime.toLowerCase())));
    const checked = await Promise.all(candidates.map(async profile => await this.verifyOwner(profile.agentDid, profile.owner) ? profile : undefined));
    const eligible = checked.filter(profile => profile !== undefined);
    return { data: eligible.slice(offset, offset + limit), total: eligible.length, offset, limit };
  }

  async ownProfiles(lobbyId: string, actor: string) {
    const profiles = this.store.readMarketplaceState(lobbyId).profiles.filter(profile => profile.owner === actor);
    return Promise.all(profiles.map(async profile => ({ ...profile,
      eligible: profile.status === 'published' && await this.verifyOwner(profile.agentDid, actor) })));
  }

  async listings(lobbyId: string, actor: string, offset: number, limit: number, reviewer = false) {
    const state = this.store.readMarketplaceState(lobbyId);
    const entries = state.listings.map(entry => activeListing(entry))
      .filter(entry => entry.buyer === actor || entry.status === 'open' ||
        state.agreements.some(agreement => agreement.listing.id === entry.id &&
          (agreement.bid.specialist === actor || reviewer && agreement.delivery?.status === 'disputed')));
    return { data: entries.slice(offset, offset + limit), total: entries.length, offset, limit,
      legacy: (await this.store.listMarketplaceTasks(lobbyId)).filter(entry => entry.posted_by_identity_ref === actor)
        .map(entry => ({ id: entry.id, title: entry.title, status: entry.status, legacyAuthorization: Boolean(entry.escrow_signature || entry.release_signature) })) };
  }

  bids(lobbyId: string, actor: string, listingId: string, offset: number, limit: number, reviewer = false) {
    const state = this.store.readMarketplaceState(lobbyId);
    const listing = state.listings.find(entry => entry.id === listingId);
    if (!listing) throw new MarketplaceError('Listing not found.', 404);
    const entries = state.bids.filter(entry => entry.listingId === listingId && (listing.buyer === actor || entry.specialist === actor));
    return { data: entries.slice(offset, offset + limit), total: entries.length, offset, limit,
      agreement: state.agreements.find(entry => entry.listing.id === listingId &&
        (entry.listing.buyer === actor || entry.bid.specialist === actor || reviewer && entry.delivery?.status === 'disputed')) };
  }

  async profile(lobbyId: string, actor: string, body: Record<string, unknown>, manager: boolean) {
    const id = typeof body.id === 'string' ? body.id : randomUUID();
    const action = body.action;
    if (action === 'suspend' || action === 'unpublish') {
      return this.store.mutateMarketplaceState(lobbyId, state => {
        const profile = state.profiles.find(entry => entry.id === id);
        if (!profile || !(action === 'suspend' ? manager : profile.owner === actor)) throw new MarketplaceError('Profile action forbidden.', 403);
        profile.status = action === 'suspend' ? 'suspended' : 'unpublished';
        profile.updatedAt = Date.now();
        log(state, actor, `profile_${action}`, id);
        return profile;
      });
    }
    if (action !== 'publish') throw new MarketplaceError('Choose a profile action.', 400);
    const agentDid = field(body.agentDid, 'an Agent ID', 256);
    if (!await this.verifyOwner(agentDid, actor)) throw new MarketplaceError('Active registry ownership required.', 403);
    const profile: SpecialistProfile = { id, owner: actor, agentDid, status: 'published', updatedAt: Date.now(),
      displayName: field(body.displayName, 'a display name', 120), skills: fields(body.skills, 'skills'),
      runtimes: fields(body.runtimes, 'supported runtimes'), availability: field(body.availability, 'availability', 300),
      workSamples: fields(body.workSamples, 'work samples') };
    return this.store.mutateMarketplaceState(lobbyId, state => {
      const index = state.profiles.findIndex(entry => entry.id === id || entry.agentDid === agentDid);
      const previous = state.profiles[index];
      if (previous && (previous.owner !== actor || previous.agentDid !== agentDid || previous.status === 'suspended')) {
        throw new MarketplaceError('Profile publication forbidden.', 403);
      }
      if (previous) { profile.id = previous.id; state.profiles[index] = profile; }
      else state.profiles.push(profile);
      log(state, actor, 'profile_publish', profile.id, agentDid);
      return profile;
    });
  }

  listing(lobbyId: string, buyer: string, body: Record<string, unknown>) {
    const id = typeof body.id === 'string' ? body.id : randomUUID();
    return this.store.mutateMarketplaceState(lobbyId, state => {
      const index = state.listings.findIndex(entry => entry.id === id);
      const current = state.listings[index];
      if (current && current.buyer !== buyer) throw new MarketplaceError('Listing action forbidden.', 403);
      if (current && (body.version !== current.version || !['draft', 'open'].includes(activeListing(current).status))) {
        throw new MarketplaceError('Listing changed or closed. Refresh before editing.');
      }
      if (body.action === 'cancel' && current) {
        current.status = 'cancelled';
        current.version++;
        log(state, buyer, 'listing_cancel', id);
        return current;
      }
      if (body.action !== 'publish' && body.action !== 'draft') throw new MarketplaceError('Choose a listing action.', 400);
      if (typeof body.deadline !== 'number' || !Number.isSafeInteger(body.deadline) || body.deadline <= Date.now()) {
        throw new MarketplaceError('Choose a future deadline.', 400);
      }
      let workspaceSource: MarketplaceListing['workspaceSource'];
      if (body.workspaceRepository !== undefined || body.workspaceRevision !== undefined) {
        const repository = field(body.workspaceRepository, 'the approved workspace repository', 200);
        const revision = field(body.workspaceRevision, 'the approved source commit', 40).toLowerCase();
        if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[0-9a-f]{40}$/.test(revision)) {
          throw new MarketplaceError('Approve a repository and full commit for cloud staging.', 400);
        }
        workspaceSource = { repository, revision };
      }
      const listing: MarketplaceListing = { id, buyer, version: (current?.version ?? 0) + 1,
        status: body.action === 'draft' ? 'draft' : 'open', quote: quote(body.amount), deadline: body.deadline,
        title: field(body.title, 'a listing title', 200), deliverable: field(body.deliverable, 'the deliverable'),
        acceptanceChecks: fields(body.acceptanceChecks, 'acceptance checks'), scope: field(body.scope, 'repository or artifact scope'), workspaceSource };
      if (current) state.listings[index] = listing;
      else state.listings.push(listing);
      log(state, buyer, `listing_${body.action}`, id);
      return listing;
    });
  }

  async bid(lobbyId: string, actor: string, listingId: string, body: Record<string, unknown>) {
    const snapshot = this.store.readMarketplaceState(lobbyId);
    const profile = snapshot.profiles.find(entry => entry.id === body.profileId && entry.owner === actor && entry.status === 'published');
    const agentId = body.action === 'withdraw' ? undefined : field(body.agentId, 'a lobby agent', 256);
    if (agentId) {
      const agent = await this.store.getAgent(lobbyId, agentId);
      if (!profile || agent?.identity_ref !== profile.agentDid || !await this.verifyOwner(profile.agentDid, actor)) {
        throw new MarketplaceError('An active specialist profile and matching lobby agent are required.', 403);
      }
    }
    return this.store.mutateMarketplaceState(lobbyId, state => {
      const listing = state.listings.find(entry => entry.id === listingId);
      if (!listing || listing.buyer === actor) throw new MarketplaceError('Bid action forbidden.', 403);
      if (activeListing(listing).status !== 'open') throw new MarketplaceError('This listing no longer accepts bid changes.');
      const index = state.bids.findIndex(entry => entry.listingId === listingId && entry.specialist === actor);
      const previous = state.bids[index];
      if (previous && body.version !== previous.version) throw new MarketplaceError('Bid changed. Refresh and review the latest terms.');
      if (body.action === 'withdraw' && previous?.status === 'submitted') {
        previous.status = 'withdrawn';
        previous.version++;
        log(state, actor, 'bid_withdraw', previous.id);
        return previous;
      }
      if (body.action !== 'submit' || !profile || !agentId || activeListing(listing).status !== 'open' ||
          listing.version !== body.listingVersion || !state.profiles.some(entry => entry.id === profile.id && entry.status === 'published')) {
        throw new MarketplaceError('The listing or specialist profile changed. Refresh before submitting.');
      }
      const { turnaroundHours, expiresAt } = body;
      if (typeof turnaroundHours !== 'number' || !Number.isSafeInteger(turnaroundHours) ||
          turnaroundHours <= 0 || Date.now() + turnaroundHours * 3_600_000 > listing.deadline ||
          typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > listing.deadline) {
        throw new MarketplaceError('Enter a valid turnaround and a bid expiry within the listing deadline.', 400);
      }
      const offer = { id: previous?.id ?? randomUUID(), listingId, listingVersion: listing.version, version: (previous?.version ?? 0) + 1,
        specialist: actor, profileId: profile.id, agentId, turnaroundHours, expiresAt, quote: quote(body.amount),
        prerequisites: field(body.prerequisites, 'prerequisites'), assumptions: field(body.assumptions, 'assumptions') };
      const bid: MarketplaceBid = { ...offer, status: 'submitted', consent: { actor, at: Date.now(), digest: digest(listing, offer) } };
      if (previous) state.bids[index] = bid;
      else state.bids.push(bid);
      log(state, actor, 'bid_submit', bid.id, bid.consent.digest);
      return bid;
    });
  }

  async hire(lobbyId: string, actor: string, listingId: string, body: Record<string, unknown>,
    stillAuthorized: () => Promise<boolean> = async () => true) {
    const snapshot = this.store.readMarketplaceState(lobbyId);
    const existing = snapshot.agreements.find(entry => entry.listing.id === listingId);
    if (existing) {
      if (existing.listing.buyer !== actor || existing.bid.id !== body.bidId || existing.bid.version !== body.bidVersion ||
          existing.listing.version !== body.listingVersion || existing.buyerConsent.digest !== body.digest) {
        throw new MarketplaceError('This listing already has an agreement.');
      }
      return this.handoff(lobbyId, existing.id);
    }
    const offered = snapshot.bids.find(entry => entry.listingId === listingId && entry.id === body.bidId);
    const profile = snapshot.profiles.find(entry => entry.id === offered?.profileId && entry.status === 'published');
    const lobby = await this.store.getLobby(lobbyId);
    const agent = offered && await this.store.getAgent(lobbyId, offered.agentId);
    if (!lobby || !offered || !profile || agent?.identity_ref !== profile.agentDid ||
        !await this.verifyOwner(profile.agentDid, offered.specialist)) throw new MarketplaceError('The specialist is no longer eligible.', 403);
    const seq = await this.store.nextSeq(lobbyId);
    if (!await stillAuthorized()) throw new MarketplaceError('Buyer authorization changed.', 403);
    const agreement = this.store.mutateMarketplaceState(lobbyId, state => {
      const listing = state.listings.find(entry => entry.id === listingId);
      const bid = state.bids.find(entry => entry.id === offered.id);
      if (!listing || listing.buyer !== actor) throw new MarketplaceError('Only the listing buyer can hire.', 403);
      if (activeListing(listing).status !== 'open' || listing.version !== body.listingVersion || !bid || bid.version !== offered.version ||
          bid.version !== body.bidVersion || bid.listingVersion !== listing.version || bid.status !== 'submitted' ||
          bid.expiresAt <= Date.now() || Date.now() + bid.turnaroundHours * 3_600_000 > listing.deadline || bid.consent.digest !== body.digest ||
          !state.profiles.some(entry => entry.id === profile.id && entry.status === 'published')) {
        throw new MarketplaceError('Terms changed, expired, or were already selected. Refresh before hiring.');
      }
      const id = randomUUID();
      const task: LobbyTask = { task_id: id, lobby_id: lobbyId, org_id: lobby.org_id, assigned_by: 'LobbyOwner',
        assigned_to: bid.agentId, assigned_at: new Date().toISOString(), title: listing.title,
        description: `${listing.deliverable}\n\nScope\n${listing.scope}\n\nAcceptance checks\n${listing.acceptanceChecks.join('\n')}\n\nDeadline\n${new Date(listing.deadline).toISOString()}`,
        output_mode: 'text', priority: 'normal', category: 'general', status: 'assigned', seq };
      listing.status = 'hired';
      bid.status = 'selected';
      for (const other of state.bids) if (other.listingId === listing.id && other.status === 'submitted') other.status = 'declined';
      const agreement = { id, assignmentId: id, listing: structuredClone(listing), bid: structuredClone(bid),
        buyerConsent: { actor, at: Date.now(), digest: bid.consent.digest }, handoff: { task, status: 'pending' as const } };
      state.agreements.push(agreement);
      log(state, actor, 'agreement_hire', id, bid.consent.digest);
      return agreement;
    });
    return this.handoff(lobbyId, agreement.id);
  }

  private async handoff(lobbyId: string, agreementId: string) {
    const key = `${lobbyId}:${agreementId}`;
    const pending = this.handoffs.get(key);
    if (pending) return pending;
    const operation = this.dispatchAgreement(lobbyId, agreementId);
    this.handoffs.set(key, operation);
    try { return await operation; }
    finally { this.handoffs.delete(key); }
  }

  private async dispatchAgreement(lobbyId: string, agreementId: string) {
    const agreement = this.store.readMarketplaceState(lobbyId).agreements.find(entry => entry.id === agreementId);
    if (!agreement) throw new MarketplaceError('Agreement not found.', 404);
    if (agreement.handoff.status === 'dispatched') return agreement;
    if (!await this.store.getTask(lobbyId, agreement.assignmentId)) await this.store.upsertTask(agreement.handoff.task);
    await this.dispatch(agreement.handoff.task);
    return this.store.mutateMarketplaceState(lobbyId, state => {
      const entry = state.agreements.find(item => item.id === agreementId)!;
      entry.handoff.status = 'dispatched';
      return entry;
    });
  }
}
