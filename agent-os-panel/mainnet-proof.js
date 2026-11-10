// SPDX-License-Identifier: Apache-2.0
const button = document.querySelector('#request-proof');
const status = document.querySelector('#proof-status');

function detectWallet() {
  if (window.concordium) return Promise.resolve(window.concordium);

  return new Promise(resolve => {
    function finish() {
      clearTimeout(timeout);
      window.removeEventListener('concordium#initialized', finish);
      resolve(window.concordium);
    }

    const timeout = setTimeout(finish, 5000);
    window.addEventListener('concordium#initialized', finish);
  });
}

async function requestProofApi(action, body) {
  const response = await fetch('/api/v1/agent-lobby/mainnet-proof/' + action, {
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
    status.textContent = 'Looking for Concordium Wallet.';
    const wallet = await detectWallet();
    if (!wallet) {
      status.textContent = 'Concordium Wallet could not connect to this page. In your browser’s extension settings, allow Concordium Wallet to access this site, then reload.';
      return;
    }
    if (typeof wallet.requestVerifiablePresentation !== 'function' ||
        (typeof wallet.connect !== 'function' && typeof wallet.requestAccounts !== 'function')) {
      status.textContent = 'The connected Concordium Wallet does not expose the proof API. Update the browser extension, then reload.';
      return;
    }
    status.textContent = 'Connect your Mainnet wallet.';
    // The hosted panel connects through connect(). Newer providers also expose requestAccounts().
    const account = typeof wallet.connect === 'function'
      ? await wallet.connect()
      : (await wallet.requestAccounts())[0];
    if (!account) {
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
