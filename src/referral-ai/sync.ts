// ABOUTME: Imports provider-owned activity and LangSmith LLM costs into the live database.
// ABOUTME: Provider records must resolve to local identity and task ownership before any write.

import type { DatabaseSync } from 'node:sqlite';
import { atomic, utcNow } from '../contracts.ts';
import { HttpError } from '../http.ts';
import { MEETING_HANDOFF_COPIED } from '../key-action.ts';
import { isUuid, object, type Providers, type SyncScope } from './providers.ts';

function scopeFor(db: DatabaseSync, input: Record<string, unknown>, until: string): SyncScope | null {
  const { taskId, userId } = input;
  if ((taskId !== undefined && !isUuid(taskId)) || (userId !== undefined && !isUuid(userId))) {
    throw new HttpError(400, 'Use a valid user or task ID.');
  }
  if (taskId) {
    const task = db.prepare('SELECT user_id, started_at FROM tasks WHERE id = ?').get(taskId);
    if (!task || (userId && task.user_id !== userId)) throw new HttpError(404, 'Task not found.');
    return { userId: String(task.user_id), taskId, since: String(task.started_at), until };
  }
  if (userId) {
    const user = db.prepare('SELECT registered_at FROM users WHERE id = ?').get(userId);
    if (!user) throw new HttpError(404, 'User not found.');
    return { userId, since: String(user.registered_at), until };
  }
  const row = db.prepare('SELECT MIN(registered_at) AS since FROM users').get();
  return typeof row?.since === 'string' ? { since: row.since, until } : null;
}

function inScope(scope: SyncScope, userId: string, taskId: string | null, occurredAt: string): boolean {
  return (!scope.userId || scope.userId === userId)
    && (!scope.taskId || scope.taskId === taskId)
    && occurredAt >= scope.since && occurredAt < scope.until;
}

function asUtc(value: unknown): string | null {
  const milliseconds = typeof value === 'number' ? value
    : typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
  return Number.isSafeInteger(milliseconds) && Math.abs(milliseconds) <= 8.64e15
    ? new Date(milliseconds).toISOString() : null;
}

// Parse decimal USD before rounding half up at the ledger precision.
function toUsdNanos(value: unknown): number {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const parts = raw.length <= 128 && /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(raw);
  if (!parts) throw new HttpError(502, 'LangSmith returned an invalid USD cost.');
  const fraction = parts[2] ?? '';
  const exponent = Number(parts[3] ?? 0) + 9 - fraction.length;
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 300) {
    throw new HttpError(502, 'LangSmith returned an invalid USD cost.');
  }
  const digits = BigInt(parts[1] + fraction);
  let nanos: bigint;
  if (exponent >= 0) {
    nanos = digits * 10n ** BigInt(exponent);
  } else {
    const divisor = 10n ** BigInt(-exponent);
    nanos = (digits + divisor / 2n) / divisor;
  }
  if (nanos > BigInt(Number.MAX_SAFE_INTEGER)) throw new HttpError(502, 'LangSmith USD cost is too large.');
  return Number(nanos);
}

async function importEvents(db: DatabaseSync, providers: Providers, scope: SyncScope, importedAt: string) {
  const user = db.prepare('SELECT registered_at FROM users WHERE id = ?');
  const task = db.prepare("SELECT scenario, started_at FROM tasks WHERE id = ? AND user_id = ? AND status = 'completed'");
  const insert = db.prepare(`
    INSERT INTO behavior_events (project_id, event_id, user_id, task_id, event_name, scenario, occurred_at, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (project_id, event_id) DO NOTHING
  `);
  let matched = 0;
  let written = 0;
  for await (const { projectId, rows } of providers.queryEvents(scope)) {
    atomic(db, () => {
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 6) {
          throw new HttpError(502, 'PostHog returned an invalid event.');
        }
        const [eventId, userId, eventName, taskId, scenario, timestamp] = row as unknown[];
        const occurredAt = asUtc(timestamp);
        if (!isUuid(eventId) || typeof userId !== 'string' || !occurredAt
            || typeof eventName !== 'string' || !providers.eventNames.has(eventName)) {
          throw new HttpError(502, 'PostHog returned an invalid event.');
        }
        const requiresTask = eventName === 'task_completed' || eventName === MEETING_HANDOFF_COPIED;
        if (requiresTask && (!isUuid(taskId) || typeof scenario !== 'string')) {
          throw new HttpError(502, 'PostHog returned a task event without its ID or scenario.');
        }
        if (taskId != null && !isUuid(taskId)) continue;
        const linkedTask = isUuid(taskId) ? taskId : null;
        const linkedScenario = typeof scenario === 'string' ? scenario : null;
        if (!inScope(scope, userId, linkedTask, occurredAt)) continue;
        const account = user.get(userId);
        if (!account || occurredAt < String(account.registered_at)) continue;
        if (linkedTask) {
          const recordedTask = task.get(linkedTask, userId);
          if (!recordedTask || (linkedScenario !== null && recordedTask.scenario !== linkedScenario)
              || occurredAt < String(recordedTask.started_at)) continue;
        }
        matched++;
        written += Number(insert.run(projectId, eventId, userId, linkedTask, eventName, linkedScenario,
          occurredAt, importedAt).changes);
      }
    });
  }
  return { matched, written };
}

async function importCosts(db: DatabaseSync, providers: Providers, scope: SyncScope, importedAt: string) {
  const task = db.prepare('SELECT started_at FROM tasks WHERE id = ? AND user_id = ?');
  const upsert = db.prepare(`
    INSERT INTO model_costs (project_id, source, run_id, user_id, task_id, occurred_at, imported_at,
      amount_usd_nanos, cost_status)
    VALUES (?, 'langsmith', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (project_id, source, run_id) DO UPDATE SET
      imported_at = excluded.imported_at,
      amount_usd_nanos = excluded.amount_usd_nanos,
      cost_status = excluded.cost_status
    WHERE model_costs.user_id = excluded.user_id
      AND model_costs.task_id = excluded.task_id
      AND model_costs.occurred_at = excluded.occurred_at
      AND excluded.cost_status = 'reported'
      AND (model_costs.cost_status <> 'reported'
        OR (excluded.imported_at >= model_costs.imported_at
          AND model_costs.amount_usd_nanos IS NOT excluded.amount_usd_nanos))
  `);
  let matched = 0;
  let written = 0;
  for await (const { projectId, rows } of providers.queryRuns(scope)) {
    atomic(db, () => {
      for (const row of rows) {
        const run = object(row);
        if (!run || typeof run.run_type !== 'string') throw new HttpError(502, 'LangSmith returned an invalid run.');
        if (run.run_type.toLowerCase() !== 'llm') continue;
        const metadata = object(run.metadata);
        const userId = metadata?.app_user_id;
        const taskId = metadata?.task_id;
        if (typeof userId !== 'string' || typeof taskId !== 'string') continue;
        const occurredAt = asUtc(run.start_time);
        if (!isUuid(run.id) || !occurredAt) throw new HttpError(502, 'LangSmith returned an invalid run.');
        if (!inScope(scope, userId, taskId, occurredAt)) continue;
        const recordedTask = task.get(taskId, userId);
        if (!recordedTask || occurredAt < String(recordedTask.started_at)) continue;
        const cost = run.total_cost == null ? null : toUsdNanos(run.total_cost);
        // LangSmith can report zero while pricing is unavailable for a metered run.
        const pricedCost = cost === 0 && Number(run.total_cost) === 0 && !run.price_model_id ? null : cost;
        matched++;
        written += Number(upsert.run(projectId, run.id, userId, taskId, occurredAt, importedAt,
          pricedCost, pricedCost === null ? 'missing' : 'reported').changes);
      }
    });
  }
  return { matched, written };
}

export async function syncProviders(db: DatabaseSync, providers: Providers, input: Record<string, unknown>) {
  const importedAt = utcNow();
  const until = new Date(Date.parse(importedAt) + 1).toISOString();
  const scope = scopeFor(db, input, until);
  if (!scope) {
    return { posthog: { matched: 0, written: 0 }, langsmith: { matched: 0, written: 0 } };
  }
  const [posthog, langsmith] = await Promise.allSettled([
    importEvents(db, providers, scope, importedAt),
    importCosts(db, providers, scope, importedAt),
  ]);
  if (posthog.status === 'rejected' && langsmith.status === 'rejected') {
    if (!(posthog.reason instanceof HttpError)) throw posthog.reason;
    if (!(langsmith.reason instanceof HttpError)) throw langsmith.reason;
    const status = posthog.reason.status === 503 && langsmith.reason.status === 503 ? 503 : 502;
    throw new HttpError(status, `${posthog.reason.message} ${langsmith.reason.message}`);
  }
  if (posthog.status === 'rejected') throw posthog.reason;
  if (langsmith.status === 'rejected') throw langsmith.reason;
  return { posthog: posthog.value, langsmith: langsmith.value };
}
