// ABOUTME: Renders the English Sandbox checkout and its buyer approval return page.
// ABOUTME: The browser sends order IDs to the application server for confirmation.

import { theme, wordmark } from '../appearance.ts';
import { TOPUP_GRANT_UNITS } from '../contracts.ts';
import { escapeHtml } from '../http.ts';
import { checkoutAmount } from './orders.ts';

export function checkoutPage(userId: string, returning: boolean, canceled: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Add credits · Word of Fit</title>
  <style>
    ${theme}
    :root { font:15px/1.5 var(--body); color:var(--ink); background:var(--canvas) }
    body { margin:0 }
    header { background:var(--forest); color:var(--paper) }
    header div { max-width:1124px; padding:0 16px; margin:auto; min-height:60px; display:flex; align-items:center }
    main { max-width:29rem; margin:2rem auto; padding:1rem }
    section { background:var(--paper); padding:clamp(1rem,4vw,1.8rem); border:1px solid var(--line); border-radius:8px }
    h1 { margin:0; font:500 2.3rem/1.05 var(--display); letter-spacing:-.04em }
    .price { font-size:1.6rem; font-weight:700; margin:.5rem 0; font-variant-numeric:tabular-nums }
    a { color:var(--green-dark); text-underline-offset:.18em }
    button { padding:.6rem .8rem; background:var(--forest); color:var(--paper); border:0; border-radius:5px; font:inherit; cursor:pointer }
    button:disabled { opacity: .55; cursor: wait; }
    #status { min-height: 1.5em; }
    details { margin-top: 1rem; }
    summary { cursor: pointer; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
<header><div><a class="wof-brand" href="/app">${wordmark}</a></div></header>
<main data-user="${escapeHtml(userId)}" data-returning="${returning}">
  <p><a href="/app">Back to Meeting Notes</a></p>
  <section>
    <h1>Add ${TOPUP_GRANT_UNITS} credits</h1>
    <p class="price">$${checkoutAmount} USD</p>
    <p>One-time top-up. Use a PayPal Sandbox buyer account.</p>
    <paypal-button id="paypal" type="pay" hidden></paypal-button>
    <button id="confirm" type="button" hidden>Check payment</button>
    <p id="status" role="status">${canceled ? 'Checkout was canceled. You can continue with the same order.' : ''}</p>
    <details id="fallback"${returning ? ' hidden' : ''}>
      <summary>Sandbox checkout link</summary>
      <p><button id="open" type="button">Open PayPal Sandbox</button></p>
    </details>
  </section>
</main>
<script>
  const page = document.querySelector('main');
  const storageKey = 'wof-paypal-topup:' + page.dataset.user;
  const paypalButton = document.getElementById('paypal');
  const fallback = document.getElementById('fallback');
  const openButton = document.getElementById('open');
  const confirmButton = document.getElementById('confirm');
  const status = document.getElementById('status');
  let topupId = sessionStorage.getItem(storageKey);
  let approvedOrder;
  let busy = false;
  let paid = false;

  function message(text) { status.textContent = text; }
  async function request(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
    return data;
  }
  function setBusy(value) {
    busy = value;
    openButton.disabled = value;
    confirmButton.disabled = value;
  }
  async function createOrder() {
    if (!topupId) {
      topupId = crypto.randomUUID();
      sessionStorage.setItem(storageKey, topupId);
    }
    return request('/api/paypal/orders', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({topupId}),
    });
  }
  async function confirmPayment(orderId) {
    approvedOrder = orderId;
    setBusy(true);
    paypalButton.hidden = true;
    fallback.hidden = true;
    confirmButton.hidden = false;
    message('Confirming payment…');
    try {
      await request('/api/paypal/orders/' + encodeURIComponent(orderId) + '/capture', {method: 'POST'});
      sessionStorage.removeItem(storageKey);
      paid = true;
      confirmButton.hidden = true;
      message('Payment confirmed. ${TOPUP_GRANT_UNITS} credits were added to your account.');
    } catch (error) {
      message(error.message);
    } finally {
      setBusy(false);
    }
  }
  confirmButton.addEventListener('click', () => confirmPayment(approvedOrder));
  openButton.addEventListener('click', async () => {
    if (busy || paid) return;
    setBusy(true);
    try {
      const {orderId, approvalUrl} = await createOrder();
      if (approvalUrl) window.location.assign(approvalUrl);
      else await confirmPayment(orderId);
    } catch (error) {
      message(error.message);
    } finally {
      setBusy(false);
    }
  });
  async function initPayPal() {
    try {
      const {clientId} = await request('/api/paypal/config');
      const sdk = await window.paypal.createInstance({
        clientId, components: ['paypal-payments'], pageType: 'checkout', locale: 'en-US',
      });
      const eligibility = await sdk.findEligibleMethods({currencyCode: 'USD', amount: '${checkoutAmount}'});
      if (!eligibility.isEligible('paypal')) {
        message('PayPal is unavailable in this browser. You can open the Sandbox checkout link.');
        return;
      }
      const checkout = await sdk.createPayPalOneTimePaymentSession({
        onApprove: ({orderId}) => confirmPayment(orderId),
        onCancel: () => { setBusy(false); message('Checkout was canceled.'); },
        onError: () => {
          if (approvedOrder) return;
          setBusy(false);
          showSdkError();
        },
      });
      paypalButton.addEventListener('click', async () => {
        if (busy || paid) return;
        setBusy(true);
        message('Opening PayPal Sandbox…');
        let resuming = false;
        const order = createOrder().then(({orderId, approvalUrl}) => {
          if (!approvalUrl) {
            resuming = true;
            void confirmPayment(orderId);
            throw new Error('This order is already approved.');
          }
          return {orderId};
        });
        try {
          await checkout.start({presentationMode: 'auto'}, order);
        } catch (error) {
          if (!resuming && !approvedOrder) message(error.message || 'PayPal checkout could not start.');
          if (!approvedOrder) setBusy(false);
        }
      });
      paypalButton.hidden = false;
    } catch {
      showSdkError();
    }
  }
  function showSdkError() {
    message('PayPal checkout could not load. You can open the Sandbox checkout link.');
  }
  if (page.dataset.returning === 'true') {
    const token = new URLSearchParams(location.search).get('token');
    if (token && /^[A-Za-z0-9_-]{1,128}$/.test(token)) {
      approvedOrder = token;
      confirmButton.hidden = false;
      message('PayPal returned you to Word of Fit. Check payment to confirm your credits.');
    } else {
      message('PayPal did not return an order. Return to the app to open checkout.');
    }
  } else {
    const script = document.createElement('script');
    script.src = 'https://www.sandbox.paypal.com/web-sdk/v6/core';
    script.async = true;
    script.onload = initPayPal;
    script.onerror = showSdkError;
    document.head.append(script);
  }
</script>
</body>
</html>`;
}
