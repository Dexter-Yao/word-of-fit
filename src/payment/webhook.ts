// ABOUTME: Maps verified PayPal deliveries to local captures and refunds.
// ABOUTME: Every monetary event is reconciled with the order or capture before it can affect receipts.

import { HttpError, readRawBody, sendJson, type Context } from '../http.ts';
import {
  captureById, captureForTopup, conflict, recordCapture, recordRefund, topupForCapture, topupForOrder,
  type BoundTopup, type Delivery, type RecoveredCapture,
} from './ledger.ts';
import { isSettledCapture, lookupOrder, merchant, occurredAt, usdCents } from './orders.ts';
import { identifier, object, paypal, verifyDelivery, type JsonObject } from './paypal.ts';

const captureEvent = 'PAYMENT.CAPTURE.COMPLETED';
const refundEvent = 'PAYMENT.CAPTURE.REFUNDED';
const apiHosts = new Set(['https://api-m.sandbox.paypal.com', 'https://api.sandbox.paypal.com']);

function linkedParent(resource: JsonObject, path: string): string | undefined {
  if (!Array.isArray(resource.links)) return;
  for (const candidate of resource.links) {
    const link = object(candidate);
    if (link?.rel !== 'up' || typeof link.href !== 'string') continue;
    const url = URL.parse(link.href);
    if (url && apiHosts.has(url.origin) && !url.username && !url.password && url.pathname.startsWith(path)) {
      const id = identifier(url.pathname.slice(path.length));
      if (id) return id;
    }
  }
}

function relatedOrder(resource: JsonObject): string | undefined {
  const declared = object(object(resource.supplementary_data)?.related_ids)?.order_id;
  const linked = linkedParent(resource, '/v2/checkout/orders/');
  if (declared !== undefined && (!identifier(declared) || (linked && linked !== declared))) conflict();
  return identifier(declared) ?? linked;
}

async function confirmOriginalCapture(
  ctx: Context, topup: BoundTopup, captureId: string, amount: number, observedMerchant?: string,
) {
  if (amount !== topup.amount_cents) conflict();
  const capture = captureForTopup(ctx.db, topup.id) ?? (await lookupOrder(topup)).settledCapture;
  if (!capture) throw new HttpError(503, 'PayPal order has not confirmed the capture yet.');
  if (capture.id !== captureId || capture.amount_cents !== amount) conflict();
  merchant(capture.merchant_id, observedMerchant);
  return capture;
}

async function applyCapture(ctx: Context, resource: JsonObject, receipt: Delivery): Promise<void> {
  if (resource.status !== 'COMPLETED') conflict();
  const amount = usdCents(resource.amount);
  let notifiedMerchant = merchant(object(resource.payee)?.merchant_id);
  const captureId = receipt.resourceId;
  const knownTopup = topupForCapture(ctx.db, captureId);
  let orderId = relatedOrder(resource) ?? knownTopup?.paypal_order_id;
  if (!orderId) {
    const details = await paypal('GET', '/v2/payments/captures/' + captureId);
    if (details.id !== captureId || usdCents(details.amount) !== amount) conflict();
    notifiedMerchant = merchant(notifiedMerchant, object(details.payee)?.merchant_id);
    orderId = relatedOrder(details);
  }

  const topup = orderId ? topupForOrder(ctx.db, orderId) : undefined;
  if (!topup) throw new HttpError(503, 'PayPal order mapping is not available yet.');
  if ((resource.custom_id !== undefined && resource.custom_id !== topup.id) ||
      (knownTopup && knownTopup.id !== topup.id)) conflict();

  const capture = await confirmOriginalCapture(ctx, topup, captureId, amount, notifiedMerchant);
  recordCapture(ctx.db, topup, capture, receipt);
}

async function recoverRefundedCapture(ctx: Context, captureId: string): Promise<RecoveredCapture> {
  // A verified refund may arrive before the capture event. Resolve the original order through PayPal.
  const details = await paypal('GET', '/v2/payments/captures/' + captureId);
  if (details.id !== captureId) conflict();
  if (!isSettledCapture(details.status)) throw new HttpError(503, 'Original PayPal capture is not available yet.');
  const orderId = relatedOrder(details);
  const topup = orderId ? topupForOrder(ctx.db, orderId) : undefined;
  if (!topup) throw new HttpError(503, 'PayPal order mapping is not available yet.');
  if (details.custom_id !== undefined && details.custom_id !== topup.id) conflict();
  const capture = await confirmOriginalCapture(ctx, topup, captureId, usdCents(details.amount),
    merchant(object(details.payee)?.merchant_id));
  return { topup, capture };
}

async function applyRefund(ctx: Context, resource: JsonObject, receipt: Delivery): Promise<void> {
  // Some refunds settle asynchronously. PayPal can send a later completed notification.
  if (resource.status === 'PENDING' || resource.status === 'FAILED' || resource.status === 'CANCELLED') return;
  if (resource.status !== 'COMPLETED') conflict();
  const refund = await paypal('GET', '/v2/payments/refunds/' + receipt.resourceId);
  if (refund.id !== receipt.resourceId) conflict();
  if (refund.status === 'PENDING') throw new HttpError(503, 'PayPal refund has not settled yet.');
  if (refund.status !== 'COMPLETED') conflict();
  const amount = usdCents(refund.amount);
  const captureId = linkedParent(refund, '/v2/payments/captures/');
  const notifiedCaptureId = linkedParent(resource, '/v2/payments/captures/');
  if (!captureId || (notifiedCaptureId && notifiedCaptureId !== captureId) ||
      (resource.amount !== undefined && usdCents(resource.amount) !== amount)) conflict();

  // The signed completed snapshot is tied to this transition, even if a later lookup was updated again.
  const updatedAt = resource.update_time ?? refund.update_time;
  if (updatedAt == null) throw new HttpError(503, 'PayPal refund completion time is unavailable.');
  const completedAt = occurredAt(updatedAt);
  const initiatedAt = refund.create_time == null ? undefined : occurredAt(refund.create_time);
  if (initiatedAt && completedAt < initiatedAt) conflict();

  const recovered = captureById(ctx.db, captureId) ? undefined : await recoverRefundedCapture(ctx, captureId);
  recordRefund(ctx.db, {
    id: receipt.resourceId, capture_id: captureId, amount_cents: amount,
    currency: 'USD', occurred_at: completedAt,
    // Repair timestamps written by the former create_time rule when the signed snapshot supplies evidence.
    repairFrom: resource.update_time == null ? undefined : initiatedAt,
  }, receipt, recovered);
}

export async function handleWebhook(ctx: Context): Promise<void> {
  const { event, transmissionId } = await verifyDelivery(await readRawBody(ctx), ctx.request);
  if (event.event_type !== captureEvent && event.event_type !== refundEvent) {
    sendJson(ctx, 200, { ok: true });
    return;
  }

  const eventId = identifier(event.id);
  const resource = object(event.resource);
  const resourceId = identifier(resource?.id);
  if (!eventId || !resource || !resourceId) throw new HttpError(400, 'Invalid PayPal event.');
  const receipt = { eventId, type: event.event_type, resourceId, transmissionId };
  if (event.event_type === captureEvent) await applyCapture(ctx, resource, receipt);
  else await applyRefund(ctx, resource, receipt);
  sendJson(ctx, 200, { ok: true });
}
