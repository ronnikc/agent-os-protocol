// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ApiRuntimeConfig } from '@agent-os/adapters';
import type { HostedAgentOptions } from './hosted-agent-runner.js';
import { HostedControlError, type HostedControls } from './hosted-controls.js';

/** Count model capacity in input + output tokens, independently of compute charges. */
export function hostedModelBudget(controls: HostedControls, lobbyId: string) {
  const context = new AsyncLocalStorage<{ id: string; signal: AbortSignal }>();
  const run: NonNullable<HostedAgentOptions['run']> = (taskId, work) =>
    controls.runModel(lobbyId, taskId, (id, signal) => context.run({ id, signal }, work));
  const guardedCompletion: NonNullable<ApiRuntimeConfig['guardedCompletion']> = async (request, complete) => {
    const active = context.getStore();
    if (!active) throw new HostedControlError('Hosted model run is missing its reservation context.');
    active.signal.throwIfAborted();
    // Allow for provider message framing and tool schema serialization.
    const inputAllowance = Buffer.byteLength(JSON.stringify(request), 'utf8') + 256 + 32 * request.messages.length;
    const maxOutputTokens = 1024;
    const reservation = controls.reserveModel(lobbyId, active.id, inputAllowance + maxOutputTokens);
    let result;
    try {
      result = await complete({ ...request, signal: active.signal, maxOutputTokens });
    } catch {
      throw new HostedControlError('Model request failed. Unconfirmed usage remains reserved.');
    }
    const input = result.usage?.inputTokens;
    const output = result.usage?.outputTokens;
    const actual = Number.isSafeInteger(input) && input! >= 0 && Number.isSafeInteger(output) && output! >= 0
      ? input! + output! : undefined;
    if (controls.reconcileModel(lobbyId, active.id, reservation, actual)) {
      throw new HostedControlError('Provider usage exceeded the reserved model capacity.');
    }
    active.signal.throwIfAborted();
    return result;
  };
  return { run, guardedCompletion, workSignal: () => context.getStore()?.signal };
}
