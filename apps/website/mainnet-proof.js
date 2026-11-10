// SPDX-License-Identifier: Apache-2.0
const button = document.querySelector('#request-proof');
const status = document.querySelector('#proof-status');

async function requestProofApi(action, body) {
  const response = await fetch('/api/mainnet-proof/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-OS-Proof': '1' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message);
  return result;
}

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const wallet = window.concordium;
    if (typeof wallet?.requestVerifiablePresentation !== 'function') {
      status.textContent = 'Open this page in a browser profile with Concordium Wallet for Web installed.';
      return;
    }
    status.textContent = 'Connect your Mainnet wallet.';
    if (!(await wallet.requestAccounts())[0]) {
      status.textContent = 'Select an account in Concordium Wallet and try again.';
      return;
    }
    const { challenge, statement } = await requestProofApi('challenge', {});
    status.textContent = 'Review and approve the zero-knowledge age-range proof in your wallet.';
    const presentation = await wallet.requestVerifiablePresentation(challenge, statement);
    status.textContent = 'Checking the proof with Concordium Mainnet.';
    const result = await requestProofApi('verify', presentation);
    status.textContent = result.message;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'The proof request was interrupted. Try again.';
  } finally {
    button.disabled = false;
  }
});
