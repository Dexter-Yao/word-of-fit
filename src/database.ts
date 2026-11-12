// ABOUTME: Owns opening the local SQLite database and applying ordered migrations.
// ABOUTME: Each checkout gets a separate database by default, and a migration batch commits atomically.

import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const checkout = fileURLToPath(new URL('../', import.meta.url));
const migrations = new URL('../db/migrations/', import.meta.url);

function applyMigrations(database: DatabaseSync): void {
  const files = readdirSync(migrations).filter((file) => file.endsWith('.sql')).sort();
  if (files.length === 0 || files.some((file, index) => {
    const version = String(index + 1).padStart(4, '0');
    return !new RegExp(`^${version}_[a-z0-9_]+\\.sql$`).test(file);
  })) {
    throw new Error('Migration files must start at 0001 and have consecutive versions.');
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    const hasHistory = database.prepare(
      "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'",
    ).get();
    const history = hasHistory
      ? database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()
      : [];
    if (history.some((row, index) => row.version !== index + 1 || row.name !== files[index])) {
      throw new Error('Database migration history does not match this checkout.');
    }

    for (const [offset, filename] of files.slice(history.length).entries()) {
      database.exec(readFileSync(new URL(filename, migrations), 'utf8'));
      database.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
        .run(history.length + offset + 1, filename);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase(path = '.local/word-of-fit.sqlite3'): DatabaseSync {
  const dbPath = resolve(checkout, path);
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  try {
    closeSync(openSync(dbPath, 'wx', 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !lstatSync(dbPath).isFile()) {
      throw error;
    }
  }

  const database = new DatabaseSync(dbPath);
  try {
    database.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    applyMigrations(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function readSchemaVersion(database: DatabaseSync): number {
  const version = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version;
  if (typeof version !== 'number' || version < 1) {
    throw new Error('Database has no applied migrations.');
  }
  return version;
}
