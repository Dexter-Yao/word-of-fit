// ABOUTME: Binds each server process to one kind of database before it exposes routes.
// ABOUTME: A generated history cannot be opened by the payment and import process.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.ts';

export type ShowcaseWindow = { from: string; to: string; asOf: string };

export function openRuntime() {
  const mode = process.env.WOF_MODE ?? 'sandbox';
  if (mode !== 'sandbox' && mode !== 'showcase') {
    throw new Error('WOF_MODE must be sandbox or showcase.');
  }
  const path = process.env.WOF_DB_PATH;
  const root = fileURLToPath(new URL('../', import.meta.url));
  if (mode === 'showcase' && (!path || !existsSync(resolve(root, path)))) {
    throw new Error('Showcase mode requires an existing WOF_DB_PATH generated for the product preview.');
  }
  const db = openDatabase(path);
  try {
    const marked = db.prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'showcase_metadata'`).get();
    if (mode === 'sandbox') {
      if (marked) throw new Error('Sandbox mode requires a database without showcase history.');
      return { db, showcase: undefined };
    }
    if (!marked) throw new Error('This database is missing the showcase history marker.');
    const window = db.prepare('SELECT signup_from AS "from", signup_through AS "to", as_of AS asOf FROM showcase_metadata WHERE id = 1').get();
    if (!window || typeof window.from !== 'string' || typeof window.to !== 'string' || typeof window.asOf !== 'string'
        || !/^\d{4}-\d{2}-\d{2}$/.test(window.from) || !/^\d{4}-\d{2}-\d{2}$/.test(window.to)
        || !Number.isFinite(Date.parse(window.asOf)) || window.from > window.to || window.to > window.asOf.slice(0, 10)) {
      throw new Error('Showcase history has an invalid observation window.');
    }
    const showcase: ShowcaseWindow = { from: window.from, to: window.to, asOf: window.asOf };
    return { db, showcase };
  } catch (error) {
    db.close();
    throw error;
  }
}
