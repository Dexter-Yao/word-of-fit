// ABOUTME: Starts the Word of Fit process and exposes a loopback SQLite readiness check.
// ABOUTME: The service starts after migration and accepts only local connections.

import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readSchemaVersion } from './database.ts';
import { openRuntime } from './mode.ts';
import { HttpError, readJson, redirect, sendJson, type Context } from './http.ts';
import { clearSession, getSession, startSession } from './sessions.ts';
import { route as paymentRoute } from './payment/routes.ts';
import { route as referralRoute } from './referral-ai/routes.ts';
import { route as dashboardRoute } from './dashboard/routes.ts';

const port = process.env.WOF_PORT ?? '3000';
if (!/^\d+$/.test(port) || Number(port) > 65535) {
  throw new Error('WOF_PORT must be an integer from 0 to 65535.');
}

const { db: database, showcase } = openRuntime();
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  let url: URL;
  try {
    url = new URL(request.url ?? '/', 'http://localhost');
  } catch {
    response.writeHead(400).end();
    return;
  }
  const ctx: Context = { db: database, request, response, url, showcase };
  try {
    if (await sharedRoute(ctx)) return;
    if (!showcase) {
      if (await referralRoute(ctx)) return;
      if (await paymentRoute(ctx)) return;
    }
    if (await dashboardRoute(ctx)) return;
    sendJson(ctx, 404, { error: 'Not found.' });
  } catch (error) {
    if (response.destroyed || response.writableEnded) return;
    if (response.headersSent) {
      response.end();
      return;
    }
    if (error instanceof HttpError) {
      sendJson(ctx, error.status, { error: error.message });
      return;
    }
    console.error('Word of Fit could not complete a request.', error instanceof Error ? error.name : '');
    sendJson(ctx, 500, { error: 'The request could not be completed.' });
  }
});

async function sharedRoute(ctx: Context): Promise<boolean> {
  const path = ctx.url.pathname;
  const method = ctx.request.method;
  if (method === 'GET' && path === '/healthz') {
    try {
      sendJson(ctx, 200, { status: 'ok', schemaVersion: readSchemaVersion(ctx.db) });
    } catch {
      sendJson(ctx, 503, { status: 'unavailable' });
    }
    return true;
  }
  if (method === 'GET' && path === '/') {
    redirect(ctx, ctx.showcase ? '/founder' : '/app');
    return true;
  }
  if (method === 'GET' && path === '/api/session') {
    sendJson(ctx, 200, { session: getSession(ctx) });
    return true;
  }
  if (method === 'POST' && path === '/api/session/logout') {
    clearSession(ctx);
    sendJson(ctx, 200, { ok: true });
    return true;
  }
  if (method === 'POST' && path === '/api/founder/session') {
    const configured = process.env.WOF_FOUNDER_TOKEN;
    if (!configured) throw new HttpError(503, 'Founder access is not configured.');
    const input = await readJson(ctx, 4096);
    const hash = (value: string) => createHash('sha256').update(value).digest();
    if (typeof input.token !== 'string' || !timingSafeEqual(hash(input.token), hash(configured))) {
      throw new HttpError(403, 'Founder access denied.');
    }
    startSession(ctx, { role: 'founder', userId: null });
    sendJson(ctx, 200, { ok: true });
    return true;
  }
  return false;
}

server.once('error', (error) => {
  database.close();
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(Number(port), '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object') {
    console.log(`Word of Fit listening at http://127.0.0.1:${address.port}`);
  }
  const stop = () => server.close(() => database.close());
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
});
