// ABOUTME: Owns Meeting Notes task transitions and the matching application credit debit.
// ABOUTME: Running tasks reserve credit across model calls, with a bounded expiry for interrupted work.

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { atomic, MEETING_NOTES_UNITS, utcNow } from '../contracts.ts';
import { HttpError } from '../http.ts';
import { MEETING_NOTES, modelTimeoutMs } from './providers.ts';

export function creditBalance(db: DatabaseSync, userId: string): number {
  const row = db.prepare('SELECT COALESCE(SUM(units), 0) AS balance FROM credit_entries WHERE user_id = ?')
    .get(userId);
  return Number(row?.balance);
}

export function startTask(db: DatabaseSync, userId: string) {
  const taskId = randomUUID();
  const startedAt = utcNow();
  const expiresBefore = new Date(Date.parse(startedAt) - modelTimeoutMs * 2).toISOString();
  atomic(db, () => {
    db.prepare(`
      UPDATE tasks SET status = 'failed'
      WHERE user_id = ? AND scenario = ? AND status = 'running' AND started_at < ?
    `).run(userId, MEETING_NOTES, expiresBefore);
    const reserved = db.prepare(`
      SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND scenario = ? AND status = 'running'
    `).get(userId, MEETING_NOTES);
    if (creditBalance(db, userId) - Number(reserved?.count) * MEETING_NOTES_UNITS < MEETING_NOTES_UNITS) {
      throw new HttpError(409, 'You have no credits available. Top up or wait for a running task.');
    }
    db.prepare("INSERT INTO tasks (id, user_id, scenario, status, started_at) VALUES (?, ?, ?, 'running', ?)")
      .run(taskId, userId, MEETING_NOTES, startedAt);
  });
  return { taskId, userId, startedAt };
}

export function completeTask(db: DatabaseSync, task: ReturnType<typeof startTask>, result: string): string {
  const completedAt = utcNow();
  atomic(db, () => {
    const updated = db.prepare(`
      UPDATE tasks SET status = 'completed', completed_at = ?, result = ?
      WHERE id = ? AND user_id = ? AND status = 'running'
    `).run(completedAt, result, task.taskId, task.userId);
    if (updated.changes !== 1) throw new HttpError(409, 'The task expired. Run it again.');
    db.prepare(`
      INSERT INTO credit_entries (id, user_id, kind, reference_id, units, occurred_at)
      VALUES (?, ?, 'task_debit', ?, ?, ?)
    `).run(randomUUID(), task.userId, task.taskId, -MEETING_NOTES_UNITS, completedAt);
  });
  return completedAt;
}

export function failTask(db: DatabaseSync, taskId: string): void {
  db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ? AND status = 'running'").run(taskId);
}
