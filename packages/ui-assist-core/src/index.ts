// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Agent OS Protocol — UI Assist core.
 *
 * The neutral, framework-agnostic engine behind the embeddable overlay: the browser↔runtime event
 * contract, a transport seam (local relay or remote lobby, fake in tests), the session state
 * machine, the explicit-permission gate, response rendering, and framework integration scaffolding.
 * No DOM, no socket of its own — everything is injected, so the whole path verifies in Node.
 */

export * from './contract.js';
export * from './transport.js';
export * from './permission.js';
export * from './session.js';
export * from './render.js';
export * from './tasks.js';

// Re-export the canonical work-item types the overlay reads/writes (the "add to sprint plan" path).
export type { Task, Sprint, Phase, WorkItemStatus, Priority } from '@agent-os/protocol-core';
