// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * Loop Mode presets — ready-made `LoopSpec`s.
 *
 * The **continuous-quality** loop is the first shipped Loop preset (§12B): it expresses the
 * recurring "keep the codebase green and production-ready" workload as a single, machine-checkable
 * `LoopSpec`. It is the canonical example of a *deliberately-operated unattended* loop — it may run
 * without a human present (driven by the scheduler), so it declares `unattended: true`, but it keeps
 * a **tight allowlist**: it may auto-`commit` to a fix branch and `open-pr`, while `merge` / `deploy`
 * stay human-gated. Even so, it runs unattended only when the operator opts in at run time
 * (`allowUnattended`), per the engine's safety model.
 */

import type { LoopSpec } from '@agent-os/protocol-core';

/**
 * The continuous-quality loop: build green + tests pass + coverage threshold + a Product-QA review,
 * iterating fix-forward and opening a PR on convergence (never merging autonomously).
 */
export function continuousQualityLoop(over: Partial<LoopSpec> = {}): LoopSpec {
  return {
    goal: 'Keep the codebase continuously green and production-ready',
    exitCriteria: [
      { type: 'gate', skill: 'build-validation' },
      { type: 'tests', mustPass: true },
      { type: 'gate', skill: 'coverage-enforcement', threshold: 80 },
      { type: 'review', approver: 'product-qa' },
    ],
    maxIterations: 5,
    budget: { wallClockMin: 60 },
    strategy: 'fix-forward',
    // Every irreversible action is gated; the unattended allowlist (below, at run time) narrows
    // which of these auto-approve — only `commit` to a fix branch. `merge`/`deploy` stay human.
    approvalCheckpoints: ['commit', 'merge', 'deploy', 'scope-change'],
    unattended: true,
    onConverge: 'open-pr',
    onExhaust: 'escalate-to-human',
    ...over,
  };
}

/** Actions the continuous-quality loop may auto-approve when (and only when) run unattended. */
export const CONTINUOUS_QUALITY_ALLOWLIST = ['commit'] as const;

export interface LoopPreset {
  name: string;
  description: string;
  build: (over?: Partial<LoopSpec>) => LoopSpec;
  /** Actions safe to auto-approve when this preset runs unattended. */
  unattendedAllowlist: readonly ('commit' | 'merge' | 'deploy' | 'scope-change')[];
}

/** The shipped preset registry. */
export const LOOP_PRESETS: Record<string, LoopPreset> = {
  'continuous-quality': {
    name: 'continuous-quality',
    description: 'Keep the codebase green and production-ready (the Scheduled-QA workload as a loop)',
    build: continuousQualityLoop,
    unattendedAllowlist: CONTINUOUS_QUALITY_ALLOWLIST,
  },
};
