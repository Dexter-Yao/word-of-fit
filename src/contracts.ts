// ABOUTME: Defines the demo's shared credit units and SQLite transaction boundary.
// ABOUTME: Provider money and model cost are independent of application credit units.

import type { DatabaseSync } from 'node:sqlite';

export const DEMO_TOPUP_CENTS = 1000;
export const TRIAL_GRANT_UNITS = 3;
export const MEETING_NOTES_UNITS = 1;
export const TOPUP_GRANT_UNITS = 10;
export const USD_NANOS_PER_CENT = 10_000_000;

export function signupTrialUnits(hasReferrer: boolean): number {
  return hasReferrer ? TRIAL_GRANT_UNITS : 1;
}

export function utcNow(): string {
  return new Date().toISOString();
}

export function atomic<T>(db: DatabaseSync, write: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = write();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
