// ABOUTME: Exposes the session-bound checkout and PayPal Sandbox HTTP routes.
// ABOUTME: PayPal webhook delivery uses signature verification in place of the app cookie.

import { HttpError, readJson, redirect, sendHtml, sendJson, type RouteHandler } from '../http.ts';
import { getSession, requireUser } from '../sessions.ts';
import { checkoutPage } from './checkout.ts';
import { captureOrder, createOrder } from './orders.ts';
import { paypalClientId } from './paypal.ts';
import { handleWebhook } from './webhook.ts';

export const route: RouteHandler = async (ctx) => {
  const path = ctx.url.pathname;
  const method = ctx.request.method;
  if (method === 'GET' && (path === '/checkout' || path === '/checkout/return')) {
    const session = getSession(ctx);
    if (session?.role !== 'user' || !session.userId) redirect(ctx, '/login');
    else sendHtml(ctx, 200, checkoutPage(session.userId, path === '/checkout/return', ctx.url.searchParams.has('canceled')));
    return true;
  }

  if (method === 'GET' && path === '/api/paypal/config') {
    requireUser(ctx);
    const clientId = paypalClientId();
    if (!clientId) throw new HttpError(503, 'PayPal Sandbox is unavailable.');
    sendJson(ctx, 200, { clientId });
    return true;
  }

  if (method === 'POST' && path === '/api/paypal/orders') {
    const userId = requireUser(ctx);
    const { topupId } = await readJson(ctx, 4096);
    sendJson(ctx, 200, await createOrder(ctx.db, userId, topupId));
    return true;
  }

  const capturePath = /^\/api\/paypal\/orders\/([A-Za-z0-9_-]{1,128})\/capture$/.exec(path);
  if (method === 'POST' && capturePath) {
    const userId = requireUser(ctx);
    const capture = await captureOrder(ctx.db, userId, capturePath[1]);
    sendJson(ctx, 200, {
      topupId: capture.topup_id, captureId: capture.id, amountCents: capture.amount_cents, currency: capture.currency,
    });
    return true;
  }

  if (method === 'POST' && path === '/webhook/paypal') {
    await handleWebhook(ctx);
    return true;
  }
  return false;
};
