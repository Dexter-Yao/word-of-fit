// ABOUTME: Routes account, Meeting Notes, and founder-only connector requests.
// ABOUTME: Shared sessions and SQLite own identity; provider failures do not reverse local completions.

import { randomUUID } from 'node:crypto';
import { utcNow } from '../contracts.ts';
import { HttpError, readJson, redirect, sendHtml, sendJson, type Context, type RouteHandler } from '../http.ts';
import { MEETING_HANDOFF_COPIED } from '../key-action.ts';
import { getSession, requireFounder, requireUser, startSession } from '../sessions.ts';
import { authenticate, register } from './accounts.ts';
import { appPage, authPage } from './pages.ts';
import { createProviders, isUuid, MEETING_NOTES, type Transport } from './providers.ts';
import { syncProviders } from './sync.ts';
import { completeTask, creditBalance, failTask, startTask } from './tasks.ts';

async function readInput(ctx: Context, limit: number): Promise<Record<string, unknown>> {
  if (ctx.request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Send the request as application/json.');
  }
  return readJson(ctx, limit);
}

async function publish(write: Promise<void>, provider: string): Promise<void> {
  try {
    await write;
  } catch (error) {
    console.error(`Word of Fit could not publish to ${provider}.`, error instanceof HttpError ? error.message : '');
  }
}

export function createReferralRoute(env: NodeJS.ProcessEnv, transport: Transport): RouteHandler {
  const providers = createProviders(env, transport);
  return async (ctx) => {
    const { db, request, url } = ctx;
    const path = url.pathname;
    if (request.method === 'GET' && (path === '/signup' || path === '/login')) {
      sendHtml(ctx, 200, authPage(path === '/signup' ? 'signup' : 'login',
        (url.searchParams.get('code') ?? '').slice(0, 64)));
      return true;
    }
    if (request.method === 'GET' && path === '/app') {
      const session = getSession(ctx);
      if (!session?.userId) {
        redirect(ctx, session?.role === 'founder' ? '/founder' : '/login');
        return true;
      }
      const user = db.prepare('SELECT display_name, invite_code FROM users WHERE id = ?').get(session.userId);
      if (!user) throw new HttpError(401, 'Sign in to continue.');
      const latest = db.prepare(`
        SELECT id, result FROM tasks
        WHERE user_id = ? AND scenario = ? AND status = 'completed'
        ORDER BY completed_at DESC, id DESC LIMIT 1
      `).get(session.userId, MEETING_NOTES);
      sendHtml(ctx, 200, appPage({
        displayName: String(user.display_name),
        inviteCode: String(user.invite_code),
        publicOrigin: env.WOF_PUBLIC_ORIGIN,
        balance: creditBalance(db, session.userId),
        latestResult: typeof latest?.result === 'string' ? latest.result : null,
        latestTaskId: typeof latest?.id === 'string' ? latest.id : null,
      }));
      return true;
    }
    if (request.method === 'POST' && (path === '/api/auth/signup' || path === '/api/auth/login')) {
      const signup = path === '/api/auth/signup';
      const input = await readInput(ctx, 4096);
      const account = signup ? await register(db, input) : await authenticate(db, input);
      startSession(ctx, { role: 'user', userId: account.userId });
      await publish(providers.capture('login', randomUUID(), account.userId, utcNow()), 'PostHog');
      sendJson(ctx, signup ? 201 : 200, account);
      return true;
    }
    if (request.method === 'POST' && path === '/api/tasks/meeting-notes') {
      const userId = requireUser(ctx);
      const input = await readInput(ctx, 131_072);
      const notes = input.notes;
      if (typeof notes !== 'string' || !notes.trim() || notes.length > 12_000) {
        throw new HttpError(400, 'Enter meeting notes of up to 12,000 characters.');
      }
      const task = startTask(db, userId);
      let model: Awaited<ReturnType<typeof providers.runMeetingNotes>>;
      let completedAt: string;
      try {
        model = await providers.runMeetingNotes(notes);
        completedAt = completeTask(db, task, model.result);
      } catch (error) {
        failTask(db, task.taskId);
        throw error;
      }
      await Promise.all([
        publish(providers.capture('task_completed', task.taskId, userId, completedAt), 'PostHog'),
        publish(providers.trace({ ...task, completedAt }, model), 'LangSmith'),
      ]);
      sendJson(ctx, 200, { taskId: task.taskId, result: model.result });
      return true;
    }
    if (request.method === 'POST' && path === '/api/tasks/meeting-notes/copied') {
      const userId = requireUser(ctx);
      const { taskId, eventId, occurredAt } = await readInput(ctx, 4096);
      if (!isUuid(taskId) || !isUuid(eventId) || eventId === taskId || typeof occurredAt !== 'string') {
        throw new HttpError(400, 'Use a valid handoff and copy event.');
      }
      const task = db.prepare(`
        SELECT completed_at FROM tasks
        WHERE id = ? AND user_id = ? AND scenario = ? AND status = 'completed'
      `).get(taskId, userId, MEETING_NOTES);
      if (!task) throw new HttpError(404, 'Completed handoff not found.');
      const time = Date.parse(occurredAt);
      if (!Number.isFinite(time) || time < Date.parse(String(task.completed_at)) || time > Date.now() + 60_000) {
        throw new HttpError(400, 'Use a valid copy time.');
      }
      await providers.capture(MEETING_HANDOFF_COPIED, eventId, userId, new Date(time).toISOString(), taskId);
      sendJson(ctx, 200, { eventId });
      return true;
    }
    if (request.method === 'POST' && path === '/api/sync') {
      requireFounder(ctx);
      const input = await readInput(ctx, 4096);
      sendJson(ctx, 200, await syncProviders(db, providers, input));
      return true;
    }
    return false;
  };
}

export const route = createReferralRoute(process.env, fetch);
