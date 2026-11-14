// SPDX-License-Identifier: Apache-2.0
const endpoint = document.querySelector('#merchant-endpoint');
const form = document.querySelector('#quote-form');
const button = document.querySelector('#check-quote');
const status = document.querySelector('#merchant-status');
const quote = document.querySelector('#merchant-quote');
const network = 'ccd:4221332d34e1694168c2a0c0b3fd0f27';

endpoint.value = new URL('/api/v1/agent-lobby/x402/testnet-resource', location.origin).href;

async function checkQuote() {
  button.disabled = true;
  quote.hidden = true;
  status.textContent = 'Checking the Testnet quote…';
  try {
    const response = await fetch(endpoint.value, {
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 503) {
      status.textContent = 'This deployment has no available Testnet facilitator. Check the setup guide or try again later.';
      return;
    }
    const header = response.headers.get('PAYMENT-REQUIRED');
    if (response.status !== 402 || !header || header.length > 16_384) throw new Error('Missing quote');
    const required = JSON.parse(atob(header.replace(/-/g, '+').replace(/_/g, '/')));
    const offer = required.accepts?.[0];
    const account = /^[1-9A-HJ-NP-Za-km-z]{48,52}$/;
    if (required.x402Version !== 2 || required.resource?.url !== endpoint.value ||
        required.accepts?.length !== 1 || offer?.network !== network || offer.scheme !== 'exact' ||
        offer.asset !== 'CCD' || !['1000000', '10000000'].includes(offer.amount) ||
        !account.test(offer.payTo) || !account.test(offer.extra?.feePayer)) throw new Error('Unexpected quote');
    document.querySelector('#quote-amount').textContent = String(Number(offer.amount) / 1_000_000) + ' CCD';
    document.querySelector('#quote-recipient').textContent = offer.payTo;
    document.querySelector('#quote-sponsor').textContent = offer.extra.feePayer;
    quote.hidden = false;
    status.textContent = 'Quote available. Use your x402 client to authorize the payment.';
  } catch {
    status.textContent = 'A valid Testnet quote could not be loaded. Try again later.';
  } finally {
    button.disabled = false;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  void checkQuote();
});
document.querySelector('#copy-endpoint').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(endpoint.value);
    status.textContent = 'Endpoint copied.';
  } catch {
    endpoint.select();
    status.textContent = 'Copy the selected endpoint.';
  }
});
void checkQuote();
