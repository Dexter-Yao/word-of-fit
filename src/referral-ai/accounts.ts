// ABOUTME: Owns user registration, locked referral attribution, and password verification.
// ABOUTME: The signup grant and its confirmed referral attribution commit with the account.

import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import { atomic, signupTrialUnits, utcNow } from '../contracts.ts';
import { HttpError } from '../http.ts';

const deriveKey = promisify(scrypt);
const passwordHashPattern = /^scrypt:([0-9a-f]{32}):([0-9a-f]{128})$/;
const invitePattern = /^[A-Za-z0-9_-]{1,64}$/;

function emailAddress(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  return email;
}

function passwordInput(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new HttpError(400, 'Enter a password between 8 and 128 characters.');
  }
  return value;
}

export async function register(db: DatabaseSync, input: Record<string, unknown>) {
  const email = emailAddress(input.email);
  const password = passwordInput(input.password);
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (!displayName || displayName.length > 80) throw new HttpError(400, 'Enter a name of up to 80 characters.');
  const code = input.inviteCode === undefined ? ''
    : typeof input.inviteCode === 'string' ? input.inviteCode.trim() : null;
  if (code === null || (code && !invitePattern.test(code))) {
    throw new HttpError(400, 'Correct the invite code or clear the field.');
  }

  const salt = randomBytes(16);
  const digest = await deriveKey(password, salt, 64) as Buffer;
  const passwordHash = `scrypt:${salt.toString('hex')}:${digest.toString('hex')}`;
  const userId = randomUUID();
  const inviteCode = randomBytes(12).toString('base64url');

  atomic(db, () => {
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'This email is already registered. Sign in to continue.');
    }
    const referrer = code ? db.prepare('SELECT id FROM users WHERE invite_code = ?').get(code) : undefined;
    if (code && !referrer) throw new HttpError(400, 'Correct the invite code or clear the field.');
    const registeredAt = utcNow();
    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, invite_code, referrer_id, registered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, email, passwordHash, displayName, inviteCode, referrer?.id ?? null, registeredAt);
    db.prepare(`
      INSERT INTO credit_entries (id, user_id, kind, reference_id, units, occurred_at)
      VALUES (?, ?, 'trial_grant', ?, ?, ?)
    `).run(randomUUID(), userId, userId, signupTrialUnits(Boolean(referrer)), registeredAt);
  });
  return { userId, inviteCode };
}

export async function authenticate(db: DatabaseSync, input: Record<string, unknown>) {
  const email = emailAddress(input.email);
  const password = passwordInput(input.password);
  const user = db.prepare('SELECT id, password_hash, invite_code FROM users WHERE email = ?').get(email);
  const stored = passwordHashPattern.exec(String(user?.password_hash ?? ''));
  const salt = stored ? Buffer.from(stored[1], 'hex') : Buffer.alloc(16);
  const expected = stored ? Buffer.from(stored[2], 'hex') : Buffer.alloc(64);
  const digest = await deriveKey(password, salt, 64) as Buffer;
  if (!timingSafeEqual(digest, expected) || !stored || !user) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  return { userId: String(user.id), inviteCode: String(user.invite_code) };
}
