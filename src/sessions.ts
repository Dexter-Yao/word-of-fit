// ABOUTME: Stores hashed opaque session tokens and enforces distinct user and founder roles.
// ABOUTME: The browser receives only a short-lived, HTTP-only cookie.

import { createHash, randomBytes } from 'node:crypto';
import { HttpError, type Context } from './http.ts';

export type Session = { role: 'user' | 'founder'; userId: string | null };

const sessionSeconds = 8 * 60 * 60;
const publicOrigin = process.env.WOF_PUBLIC_ORIGIN;
const secureCookie = publicOrigin ? new URL(publicOrigin).protocol === 'https:' : false;

function cookieName(ctx: Context): string {
  // Browser cookies are shared across ports on the same host.
  return ctx.showcase ? 'wof_showcase_session' : 'wof_session';
}

function readToken(ctx: Context): string | null {
  const name = cookieName(ctx);
  const candidates = (ctx.request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (candidates.length !== 1) return null;
  const token = candidates[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function setCookie(ctx: Context, token: string, maxAge: number): void {
  const secure = secureCookie ? '; Secure' : '';
  ctx.response.appendHeader(
    'Set-Cookie',
    `${cookieName(ctx)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  );
}

export function getSession(ctx: Context): Session | null {
  const token = readToken(ctx);
  if (!token) return null;
  const row = ctx.db.prepare(
    'SELECT role, user_id FROM sessions WHERE token_hash = ? AND expires_at > ?',
  ).get(hashToken(token), new Date().toISOString());
  if (row?.role === 'user' && typeof row.user_id === 'string') {
    return { role: 'user', userId: row.user_id };
  }
  if (row?.role === 'founder' && row.user_id === null) {
    return { role: 'founder', userId: null };
  }
  return null;
}

export function requireUser(ctx: Context): string {
  const session = getSession(ctx);
  if (session?.role !== 'user' || session.userId === null) {
    throw new HttpError(401, 'Sign in to continue.');
  }
  return session.userId;
}

export function requireFounder(ctx: Context): void {
  if (getSession(ctx)?.role !== 'founder') {
    throw new HttpError(403, 'Founder access required.');
  }
}

export function startSession(ctx: Context, session: Session): void {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionSeconds * 1_000).toISOString();
  ctx.db.prepare(
    'INSERT INTO sessions (token_hash, role, user_id, expires_at) VALUES (?, ?, ?, ?)',
  ).run(hashToken(token), session.role, session.userId, expiresAt);
  const oldToken = readToken(ctx);
  if (oldToken) ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(oldToken));
  setCookie(ctx, token, sessionSeconds);
}

export function clearSession(ctx: Context): void {
  const token = readToken(ctx);
  if (token) ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  setCookie(ctx, '', 0);
}
