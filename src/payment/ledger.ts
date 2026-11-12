// ABOUTME: Owns local PayPal order, payment, delivery, and top-up credit facts.
// ABOUTME: The capture and one matching credit grant commit together under the shared transaction.

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { atomic, DEMO_TOPUP_CENTS, TOPUP_GRANT_UNITS, utcNow } from '../contracts.ts';
import { HttpError } from '../http.ts';

type Topup = {
  id: string;
  user_id: string;
  amount_cents: number;
  currency: 'USD';
  create_key: string;
  capture_key: string;
  created_at: string;
  paypal_order_id: string | null;
};

export type BoundTopup = Topup & { paypal_order_id: string };
export type Capture = {
  id: string;
  topup_id: string;
  merchant_id: string;
  amount_cents: number;
  currency: 'USD';
  occurred_at: string;
};
export type Refund = {
  id: string;
  capture_id: string;
  amount_cents: number;
  currency: 'USD';
  occurred_at: string;
};
export type Delivery = { eventId: string; type: string; resourceId: string; transmissionId: string };
export type RecoveredCapture = { topup: BoundTopup; capture: Capture };

export function conflict(): never {
  throw new HttpError(409, 'PayPal payment details conflict. This order requires reconciliation.');
}

export function reserveTopup(db: DatabaseSync, userId: string, id: string): Topup {
  return atomic(db, () => {
    db.prepare(`
      INSERT INTO topups (id, user_id, amount_cents, currency, create_key, capture_key, created_at)
      VALUES (?, ?, ?, 'USD', ?, ?, ?) ON CONFLICT (id) DO NOTHING
    `).run(id, userId, DEMO_TOPUP_CENTS, randomUUID(), randomUUID(), utcNow());
    const topup = db.prepare('SELECT * FROM topups WHERE id = ? AND user_id = ?').get(id, userId) as Topup | undefined;
    if (!topup) throw new HttpError(404, 'Top-up not found.');
    if (topup.amount_cents !== DEMO_TOPUP_CENTS || topup.currency !== 'USD') conflict();
    return topup;
  });
}

export function bindOrder(db: DatabaseSync, topup: Topup, orderId: string): BoundTopup {
  return atomic(db, () => {
    const other = topupForOrder(db, orderId);
    if (other && other.id !== topup.id) conflict();
    const result = db.prepare(`
      UPDATE topups SET paypal_order_id = ?
      WHERE id = ? AND (paypal_order_id IS NULL OR paypal_order_id = ?)
    `).run(orderId, topup.id, orderId);
    if (!result.changes) conflict();
    return { ...topup, paypal_order_id: orderId };
  });
}

export function topupForOrder(db: DatabaseSync, orderId: string): BoundTopup | undefined {
  return db.prepare('SELECT * FROM topups WHERE paypal_order_id = ?').get(orderId) as BoundTopup | undefined;
}

export function captureForTopup(db: DatabaseSync, topupId: string): Capture | undefined {
  return db.prepare('SELECT * FROM captures WHERE topup_id = ?').get(topupId) as Capture | undefined;
}

export function captureById(db: DatabaseSync, id: string): Capture | undefined {
  return db.prepare('SELECT * FROM captures WHERE id = ?').get(id) as Capture | undefined;
}

export function topupForCapture(db: DatabaseSync, captureId: string): BoundTopup | undefined {
  return db.prepare(`
    SELECT topups.* FROM topups JOIN captures ON captures.topup_id = topups.id
    WHERE captures.id = ? AND topups.paypal_order_id IS NOT NULL
  `).get(captureId) as BoundTopup | undefined;
}

function writeDelivery(db: DatabaseSync, receipt: Delivery): void {
  const event = db.prepare('SELECT event_type, resource_id FROM webhook_events WHERE id = ?').get(receipt.eventId);
  const previous = db.prepare('SELECT event_id FROM webhook_deliveries WHERE transmission_id = ?').get(receipt.transmissionId);
  if (event && (event.event_type !== receipt.type || event.resource_id !== receipt.resourceId)) conflict();
  if (previous && previous.event_id !== receipt.eventId) conflict();
  const receivedAt = utcNow();
  if (!event) db.prepare(`
    INSERT INTO webhook_events (id, event_type, resource_id, received_at) VALUES (?, ?, ?, ?)
  `).run(receipt.eventId, receipt.type, receipt.resourceId, receivedAt);
  if (!previous) db.prepare(`
    INSERT INTO webhook_deliveries (transmission_id, event_id, received_at) VALUES (?, ?, ?)
  `).run(receipt.transmissionId, receipt.eventId, receivedAt);
}

function writeCapture(db: DatabaseSync, topup: BoundTopup, capture: Capture): Capture {
  const owner = topupForOrder(db, topup.paypal_order_id);
  if (!owner || owner.id !== topup.id || owner.user_id !== topup.user_id ||
      capture.topup_id !== owner.id || capture.amount_cents !== owner.amount_cents ||
      capture.currency !== owner.currency) conflict();
  const current = captureForTopup(db, owner.id);
  const sameId = captureById(db, capture.id);
  if (sameId && sameId.topup_id !== owner.id) conflict();
  if (current && (current.id !== capture.id || current.merchant_id !== capture.merchant_id ||
      current.amount_cents !== capture.amount_cents || current.currency !== capture.currency)) conflict();

  if (!current) db.prepare(`
    INSERT INTO captures (id, topup_id, merchant_id, amount_cents, currency, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(capture.id, owner.id, capture.merchant_id, capture.amount_cents, capture.currency, capture.occurred_at);

  const grant = db.prepare(`
    SELECT user_id, units FROM credit_entries WHERE kind = 'topup_grant' AND reference_id = ?
  `).get(owner.id);
  if (grant && (grant.user_id !== owner.user_id || grant.units !== TOPUP_GRANT_UNITS)) conflict();
  if (!grant) db.prepare(`
    INSERT INTO credit_entries (id, user_id, kind, reference_id, units, occurred_at)
    VALUES (?, ?, 'topup_grant', ?, ?, ?)
  `).run(randomUUID(), owner.user_id, owner.id, TOPUP_GRANT_UNITS, (current ?? capture).occurred_at);
  return current ?? capture;
}

export function recordCapture(db: DatabaseSync, topup: BoundTopup, capture: Capture, receipt?: Delivery): Capture {
  return atomic(db, () => {
    const stored = writeCapture(db, topup, capture);
    if (receipt) writeDelivery(db, receipt);
    return stored;
  });
}

export function recordRefund(
  db: DatabaseSync, refund: Refund & { repairFrom?: string }, receipt: Delivery, recovered?: RecoveredCapture,
): void {
  atomic(db, () => {
    if (recovered && recovered.capture.id !== refund.capture_id) conflict();
    const capture = recovered
      ? writeCapture(db, recovered.topup, recovered.capture)
      : captureById(db, refund.capture_id);
    if (!capture) throw new HttpError(503, 'Original PayPal capture is not available yet.');
    const previous = db.prepare('SELECT * FROM refunds WHERE id = ?').get(refund.id);
    if (previous && (previous.capture_id !== capture.id || previous.currency !== refund.currency ||
        previous.amount_cents !== refund.amount_cents)) conflict();
    const total = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM refunds WHERE capture_id = ? AND id <> ?
    `).get(capture.id, refund.id);
    if (refund.currency !== capture.currency || Number(total?.cents) + refund.amount_cents > capture.amount_cents) conflict();

    writeDelivery(db, receipt);
    if (!previous) {
      db.prepare(`
        INSERT INTO refunds (id, capture_id, amount_cents, currency, occurred_at) VALUES (?, ?, ?, ?, ?)
      `).run(refund.id, capture.id, refund.amount_cents, refund.currency, refund.occurred_at);
    } else if (previous.occurred_at === refund.repairFrom && previous.occurred_at !== refund.occurred_at) {
      db.prepare('UPDATE refunds SET occurred_at = ? WHERE id = ?').run(refund.occurred_at, refund.id);
    }
  });
}
