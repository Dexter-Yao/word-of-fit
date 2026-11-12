// ABOUTME: Runs fixed-price Sandbox checkout and verifies provider facts before recording a capture.
// ABOUTME: A PayPal order can only be captured through the application user's stored top-up.

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DEMO_TOPUP_CENTS } from '../contracts.ts';
import { HttpError } from '../http.ts';
import {
  bindOrder, captureForTopup, conflict, recordCapture, reserveTopup, topupForOrder,
  type BoundTopup, type Capture,
} from './ledger.ts';
import { identifier, object, ordersPath, paypal, PayPalError, type JsonObject } from './paypal.ts';

export const checkoutAmount = (DEMO_TOPUP_CENTS / 100).toFixed(2);
const createRetryWindow = 6 * 60 * 60 * 1000;

export function usdCents(value: unknown): number {
  const amount = object(value);
  if (amount?.currency_code !== 'USD' || typeof amount.value !== 'string' ||
      !/^\d{1,12}(\.\d{1,2})?$/.test(amount.value)) conflict();
  const [dollars, fraction = ''] = amount.value.split('.');
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents <= 0) conflict();
  return cents;
}

export function occurredAt(value: unknown): string {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\d[Tt]\d\d:\d\d:\d\d(?:\.\d+)?(?:[Zz]|[+-]\d\d:\d\d)$/.test(value) ||
      !Number.isFinite(Date.parse(value))) conflict();
  return new Date(value).toISOString();
}

export function merchant(...values: unknown[]): string | undefined {
  const pin = process.env.PAYPAL_SANDBOX_MERCHANT_ID?.trim();
  const observed = values.filter((value) => value !== undefined);
  if (observed.some((value) => !identifier(value)) || new Set(observed).size > 1 ||
      (pin && observed.length > 0 && pin !== observed[0])) conflict();
  return identifier(observed[0]);
}

function buyerApproval(order: JsonObject): string | null {
  if (!Array.isArray(order.links)) return null;
  for (const candidate of order.links) {
    const link = object(candidate);
    if ((link?.rel !== 'approve' && link?.rel !== 'payer-action') || typeof link.href !== 'string' ||
        /[\r\n]/.test(link.href)) continue;
    const url = URL.parse(link.href);
    if (url && ['https://www.sandbox.paypal.com', 'https://sandbox.paypal.com'].includes(url.origin) &&
        !url.username && !url.password) return url.href;
  }
  return null;
}

function returnUrl(path: string): string {
  const origin = process.env.WOF_PUBLIC_ORIGIN ?? 'http://127.0.0.1:' + (process.env.WOF_PORT ?? '3000');
  const url = URL.parse(origin);
  if (!url || (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password) {
    throw new HttpError(503, 'PayPal checkout return URL is unavailable.');
  }
  return new URL(path, url.origin).href;
}

export async function createOrder(db: DatabaseSync, userId: string, proposedId: unknown): Promise<{
  topupId: string;
  orderId: string;
  approvalUrl: string | null;
}> {
  const id = proposedId === undefined ? randomUUID() : identifier(proposedId);
  if (!id) throw new HttpError(400, 'Invalid top-up ID.');
  const topup = reserveTopup(db, userId, id);
  let order: JsonObject;
  if (topup.paypal_order_id) {
    order = await paypal('GET', ordersPath + '/' + topup.paypal_order_id);
    readOrder(order, { ...topup, paypal_order_id: topup.paypal_order_id }, true);
  } else {
    const elapsed = Date.now() - Date.parse(topup.created_at);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= createRetryWindow) {
      throw new HttpError(409, 'This PayPal order requires reconciliation. The create retry window has ended.');
    }
    order = await paypal('POST', ordersPath, {
      intent: 'CAPTURE',
      purchase_units: [{ custom_id: topup.id, amount: { value: checkoutAmount, currency_code: 'USD' } }],
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', locale: 'en-US',
            return_url: returnUrl('/checkout/return'), cancel_url: returnUrl('/checkout?canceled=1'),
          },
        },
      },
    }, topup.create_key);
  }

  const orderId = identifier(order.id);
  if (!orderId || (topup.paypal_order_id && topup.paypal_order_id !== orderId)) conflict();
  readOrder(order, { ...topup, paypal_order_id: orderId }, false);
  const canConfirm = order.status === 'APPROVED' || order.status === 'COMPLETED';
  const approvalUrl = canConfirm ? null : buyerApproval(order);
  bindOrder(db, topup, orderId);
  if (!approvalUrl && !canConfirm) {
    throw new HttpError(502, 'PayPal did not return a Sandbox approval link. Retry the same top-up.');
  }
  return { topupId: topup.id, orderId, approvalUrl };
}

type OrderFacts = {
  status?: string;
  merchantId?: string;
  captureStatus?: string;
  captureId?: string;
  settledCapture?: Capture;
};

export function isSettledCapture(status: unknown): boolean {
  return status === 'COMPLETED' || status === 'PARTIALLY_REFUNDED' || status === 'REFUNDED';
}

function readOrder(order: JsonObject, topup: BoundTopup, full: boolean): OrderFacts {
  const status = identifier(order.status);
  if ((order.id !== undefined || full) && order.id !== topup.paypal_order_id) conflict();
  if (order.intent !== undefined && order.intent !== 'CAPTURE') conflict();
  if (order.status !== undefined && !status) conflict();
  if (order.purchase_units === undefined && !full) return { status };
  if (!Array.isArray(order.purchase_units) || order.purchase_units.length !== 1) conflict();
  const unit = object(order.purchase_units[0]);
  if (!unit) conflict();
  if ((unit.custom_id !== undefined || full) && unit.custom_id !== topup.id) conflict();
  if ((unit.amount !== undefined || full) && usdCents(unit.amount) !== topup.amount_cents) conflict();
  const captures = object(unit.payments)?.captures;
  if (captures !== undefined && (!Array.isArray(captures) || captures.length > 1)) conflict();
  const capture = object(captures?.[0]);
  if (captures?.length && !capture) conflict();
  const merchantId = merchant(object(unit.payee)?.merchant_id, object(capture?.payee)?.merchant_id);
  if (!capture) return { status, merchantId };

  const captureStatus = identifier(capture.status);
  const captureId = identifier(capture.id);
  if ((capture.id !== undefined && !captureId) || (capture.status !== undefined && !captureStatus)) conflict();
  const amountCents = capture.amount === undefined && !full ? undefined : usdCents(capture.amount);
  if (amountCents !== undefined && amountCents !== topup.amount_cents) conflict();
  if (capture.custom_id !== undefined && capture.custom_id !== topup.id) conflict();
  if (isSettledCapture(captureStatus) && captureId && merchantId && amountCents !== undefined &&
      order.id === topup.paypal_order_id && unit.custom_id === topup.id && unit.amount !== undefined &&
      capture.create_time !== undefined) {
    return {
      status, merchantId, captureStatus, captureId,
      settledCapture: {
        id: captureId, topup_id: topup.id, merchant_id: merchantId, amount_cents: amountCents,
        currency: topup.currency, occurred_at: occurredAt(capture.create_time),
      },
    };
  }
  return { status, merchantId, captureStatus, captureId };
}

export async function lookupOrder(topup: BoundTopup): Promise<OrderFacts> {
  return readOrder(await paypal('GET', ordersPath + '/' + topup.paypal_order_id), topup, true);
}

export async function captureOrder(db: DatabaseSync, userId: string, orderId: string): Promise<Capture> {
  const topup = topupForOrder(db, orderId);
  if (!topup || topup.user_id !== userId) throw new HttpError(404, 'PayPal order not found.');
  const current = captureForTopup(db, topup.id);
  if (current) {
    merchant(current.merchant_id);
    return recordCapture(db, topup, current);
  }

  // Check the same order first, including retries after an uncertain provider response.
  const before = await lookupOrder(topup);
  if (before.captureStatus === 'COMPLETED' && before.settledCapture) {
    return recordCapture(db, topup, before.settledCapture);
  }
  if (before.captureStatus === 'PENDING') {
    throw new HttpError(409, 'PayPal capture is pending. Check this order again later.');
  }
  if (before.captureId || before.captureStatus || before.status === 'COMPLETED') conflict();
  if (before.status !== 'APPROVED') throw new HttpError(409, 'PayPal buyer approval is required.');
  if (!before.merchantId) conflict();

  let attempted: OrderFacts | undefined;
  let providerError: PayPalError | undefined;
  try {
    const result = await paypal('POST', ordersPath + '/' + orderId + '/capture', {}, topup.capture_key);
    attempted = readOrder(result, topup, false);
  } catch (error) {
    if (!(error instanceof PayPalError)) throw error;
    providerError = error;
  }
  merchant(before.merchantId, attempted?.merchantId);
  if (attempted?.captureStatus === 'COMPLETED' && attempted.settledCapture) {
    return recordCapture(db, topup, attempted.settledCapture);
  }
  if (attempted?.captureStatus === 'PENDING') {
    throw new HttpError(409, 'PayPal capture is pending. Check this order again later.');
  }

  const after = await lookupOrder(topup);
  merchant(before.merchantId, attempted?.merchantId, after.merchantId);
  if (after.captureStatus === 'COMPLETED' && after.settledCapture) {
    if (attempted?.captureId && attempted.captureId !== after.settledCapture.id) conflict();
    return recordCapture(db, topup, after.settledCapture);
  }
  if (after.captureStatus === 'PENDING') {
    throw new HttpError(409, 'PayPal capture is pending. Check this order again later.');
  }
  if (providerError?.issue === 'INSTRUMENT_DECLINED') {
    throw new HttpError(409, 'PayPal declined the payment method. Try a different payment method for this order.');
  }
  if (providerError) throw providerError;
  throw new HttpError(409, 'PayPal has not confirmed this capture. Check the same order again.');
}
