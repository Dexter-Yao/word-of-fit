// ABOUTME: Reads dashboard facts from the shared SQLite schema without changing the application ledger.
// ABOUTME: PostHog owns imported behavior and LangSmith owns model costs.

import type { DatabaseSync } from 'node:sqlite';

export const DAY_MS = 86_400_000;
export const WEEK_DAYS = 7;

export function signupWeek(registeredAt: string): string {
  const midnight = new Date(registeredAt.slice(0, 10) + 'T00:00:00.000Z');
  const sinceMonday = (midnight.getUTCDay() + 6) % WEEK_DAYS;
  return new Date(midnight.valueOf() - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

export type Account = {
  id: string;
  name: string;
  referrerId: string | null;
  referrer: string | null;
  registeredAt: string;
};

type Timed = { at: string };
type Task = Timed & { id: string; scenario: string; startedAt: string };
type Behavior = Timed & {
  id: string;
  projectId: string;
  name: string;
  scenario: string | null;
  taskId: string | null;
  importedAt: string;
};
type Capture = Timed & { id: string; topupId: string; orderId: string | null; cents: number };
type Refund = Timed & { id: string; captureId: string; cents: number };
type Credit = Timed & {
  kind: 'trial_grant' | 'topup_grant' | 'task_debit';
  reference: string;
  units: number;
};
type Cost = Timed & {
  id: string;
  projectId: string;
  taskId: string;
  nanos: number | null;
  status: 'reported' | 'estimated' | 'missing';
  importedAt: string;
};

export type Facts = {
  tasks: Task[];
  behavior: Behavior[];
  captures: Capture[];
  refunds: Refund[];
  credits: Credit[];
  costs: Cost[];
};

export function readAccounts(
  db: DatabaseSync,
  selection: { id: string } | { from: string; through: string; asOf: string },
): Account[] {
  const single = 'id' in selection;
  const where = single ? 'u.id = ?' : 'u.registered_at >= ? AND u.registered_at < ? AND u.registered_at <= ?';
  const args = single ? [selection.id] : [selection.from, selection.through, selection.asOf];
  return db.prepare(`
    SELECT u.id, u.display_name AS name, u.referrer_id AS referrerId,
           r.display_name AS referrer, u.registered_at AS registeredAt
    FROM users u LEFT JOIN users r ON r.id = u.referrer_id
    WHERE ${where} ORDER BY u.registered_at DESC, u.id
  `).all(...args) as unknown as Account[];
}

export function readFacts(db: DatabaseSync, account: Account, asOf: string): Facts {
  const args = [account.id, account.registeredAt, asOf] as const;
  return {
    tasks: db.prepare(`
      SELECT id, scenario, started_at AS startedAt, completed_at AS at FROM tasks
      WHERE user_id = ? AND status = 'completed' AND completed_at BETWEEN ? AND ?
      ORDER BY at, id
    `).all(...args) as unknown as Task[],
    behavior: db.prepare(`
      SELECT event_id AS id, project_id AS projectId, event_name AS name, scenario, task_id AS taskId,
             occurred_at AS at, imported_at AS importedAt
      FROM behavior_events WHERE user_id = ? AND occurred_at BETWEEN ? AND ?
      ORDER BY at, projectId, id
    `).all(...args) as unknown as Behavior[],
    captures: db.prepare(`
      SELECT c.id, c.topup_id AS topupId, t.paypal_order_id AS orderId,
             c.amount_cents AS cents, c.occurred_at AS at
      FROM captures c JOIN topups t ON t.id = c.topup_id
      WHERE t.user_id = ? AND c.occurred_at BETWEEN ? AND ?
      ORDER BY at, c.id
    `).all(...args) as unknown as Capture[],
    refunds: db.prepare(`
      SELECT r.id, r.capture_id AS captureId, r.amount_cents AS cents, r.occurred_at AS at
      FROM refunds r JOIN captures c ON c.id = r.capture_id JOIN topups t ON t.id = c.topup_id
      WHERE t.user_id = ? AND r.occurred_at BETWEEN ? AND ?
      ORDER BY at, r.id
    `).all(...args) as unknown as Refund[],
    credits: db.prepare(`
      SELECT kind, reference_id AS reference, units, occurred_at AS at FROM credit_entries
      WHERE user_id = ? AND occurred_at BETWEEN ? AND ?
      ORDER BY at, kind = 'task_debit', id
    `).all(...args) as unknown as Credit[],
    costs: db.prepare(`
      SELECT run_id AS id, project_id AS projectId, task_id AS taskId, occurred_at AS at,
             imported_at AS importedAt, amount_usd_nanos AS nanos, cost_status AS status
      FROM model_costs
      WHERE user_id = ? AND occurred_at BETWEEN ? AND ? AND source = 'langsmith'
      ORDER BY at, projectId, id
    `).all(...args) as unknown as Cost[],
  };
}
