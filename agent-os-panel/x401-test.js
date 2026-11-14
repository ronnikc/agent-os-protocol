// SPDX-License-Identifier: Apache-2.0
const button = document.querySelector('#run-test');
const status = document.querySelector('#test-status');

button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Running the x401 proof exchange…';
  try {
    const response = await fetch('/api/v1/agent-lobby/x401/test-resource/check', {
      method: 'POST', headers: { 'X-Agent-OS-Proof': '1' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    if (!response.ok || result.proofStatus !== 200 || result.replayStatus !== 401) {
      status.textContent = result.error || 'The proof test did not return the expected result. Try again.';
      return;
    }
    status.textContent = 'Proof accepted (HTTP 200). Replaying the same proof was rejected (HTTP 401).';
  } catch {
    status.textContent = 'Could not reach the x401 test facility. Try again shortly.';
  } finally {
    button.disabled = false;
  }
});
