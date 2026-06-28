// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * The explicit-permission gate (IMPLEMENTATION-PLAN.md §12 safety): **UI Assist cannot edit a
 * project without explicit permission.**
 *
 * Two modes:
 *   - `suggest` (default) — the overlay may discuss, analyse, and propose; it must not authorise
 *     edits/commits. A request marked as `act` while in this mode is **blocked client-side** before
 *     it ever reaches the runtime.
 *   - `act` — the developer has explicitly granted edit/commit authority. Each turn that carries
 *     that authority appends a machine-readable authorisation marker to the captured context so the
 *     runtime can see consent was given for *this* turn.
 *
 * This is a defence-in-depth layer that sits *in front of* the relay's own "never act without
 * confirmation" system prompt — the request is gated before transmission, not just by the model.
 */

export type UiAssistMode = 'suggest' | 'act';

/** Intent of a single turn — does the developer expect the agent to change files? */
export type UiAssistIntent = 'suggest' | 'act';

/** Marker appended to context when (and only when) edit authority has been granted for a turn. */
export const ACT_AUTHORIZATION_MARKER =
  '[ui-assist: the developer has explicitly granted edit/commit authority for this turn]';

export interface PermissionGateOptions {
  /** Starting mode. Default `suggest` (safe). */
  mode?: UiAssistMode;
  /** Notified whenever the mode changes. */
  onChange?: (mode: UiAssistMode) => void;
}

export class PermissionGate {
  private _mode: UiAssistMode;
  private readonly onChange?: (mode: UiAssistMode) => void;

  constructor(options: PermissionGateOptions = {}) {
    this._mode = options.mode ?? 'suggest';
    this.onChange = options.onChange;
  }

  get mode(): UiAssistMode {
    return this._mode;
  }

  /** Grant edit/commit authority (switch to `act`). Must be an explicit, user-driven call. */
  grant(): void {
    this.set('act');
  }

  /** Revoke edit authority (back to `suggest`). */
  revoke(): void {
    this.set('suggest');
  }

  private set(mode: UiAssistMode): void {
    if (this._mode === mode) return;
    this._mode = mode;
    this.onChange?.(this._mode);
  }

  /** Whether a turn with the given intent may proceed under the current mode. */
  isAllowed(intent: UiAssistIntent): boolean {
    return intent === 'suggest' || this._mode === 'act';
  }

  /**
   * Throws when an `act` turn is attempted in `suggest` mode. Returns the authorisation marker to
   * append to context for an authorised `act` turn, or `undefined` for a plain `suggest` turn.
   */
  assertAndMark(intent: UiAssistIntent): string | undefined {
    if (!this.isAllowed(intent)) {
      throw new PermissionDeniedError();
    }
    return intent === 'act' ? ACT_AUTHORIZATION_MARKER : undefined;
  }
}

export class PermissionDeniedError extends Error {
  readonly code = 'permission-required';
  constructor() {
    super('UI Assist is in suggest-only mode — grant edit permission before requesting an action.');
    this.name = 'PermissionDeniedError';
  }
}
