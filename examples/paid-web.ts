// ABOUTME: Creates the isolated paid web workspace for founder filter acceptance.
// ABOUTME: All events, model costs and payment records are synthetic.

import { closeSync, openSync } from 'node:fs';
import { atomic, DEMO_TOPUP_CENTS, MEETING_NOTES_UNITS, signupTrialUnits, TOPUP_GRANT_UNITS } from '../src/contracts.ts';
import { openDatabase } from '../src/database.ts';

const databasePath = process.argv[2];
if (!databasePath) throw new Error('Pass a fresh database path for the paid web fixture.');
closeSync(openSync(databasePath, 'wx', 0o600));
const db = openDatabase(databasePath);
const asOf = '2026-11-12T10:00:00.000Z';

try {
  atomic(db, () => {
    db.exec(`CREATE TABLE showcase_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1), signup_from TEXT NOT NULL,
      signup_through TEXT NOT NULL, as_of TEXT NOT NULL
    ) STRICT`);
    db.prepare('INSERT INTO showcase_metadata VALUES (1, ?, ?, ?)').run('2026-10-01', '2026-11-12', asOf);
    const accounts = [
      ['alex', 'Alex', null, '2026-10-01T08:00:00.000Z'],
      ['riley', 'Riley', null, '2026-10-01T10:00:00.000Z'],
      ['jamie', 'Jamie', 'alex', '2026-10-12T09:00:00.000Z'],
      ['taylor', 'Taylor', 'riley', '2026-10-13T08:00:00.000Z'],
      ['casey', 'Casey', 'alex', '2026-10-14T10:00:00.000Z'],
      ['sam', 'Sam', 'riley', '2026-10-14T12:00:00.000Z'],
      ['robin', 'Robin', 'alex', '2026-10-16T09:00:00.000Z'],
      ['morgan', 'Morgan', 'alex', '2026-11-12T02:00:00.000Z'],
    ] as const;
    const user = db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)');
    const credit = db.prepare('INSERT INTO credit_entries VALUES (?, ?, ?, ?, ?, ?)');
    const event = db.prepare("INSERT INTO behavior_events VALUES ('fictional-web-app', ?, ?, ?, ?, ?, ?, ?)");
    for (const [id, name, referrer, at] of accounts) {
      user.run(id, id + '@example.test', 'fixture-only', name, id + '-invite', referrer, at);
      credit.run(id + '-trial', id, 'trial_grant', id, signupTrialUnits(referrer !== null), at);
      event.run(id + '-login', id, null, 'login', null, at, at);
    }
    const task = db.prepare("INSERT INTO tasks (id, user_id, scenario, status, started_at, completed_at) VALUES (?, ?, ?, 'completed', ?, ?)");
    const cost = db.prepare("INSERT INTO model_costs VALUES ('fictional-web-app', 'langsmith', ?, ?, ?, ?, ?, ?, 'estimated')");
    for (const [id, date, scenario, nanos] of [
      ['jamie', '2026-10-12T09', 'Team Report Export', 8_000_000],
      ['jamie', '2026-10-27T09', 'Team Report Export', 4_000_000],
      ['taylor', '2026-10-13T08', 'Team Report Export', 4_000_000],
      ['casey', '2026-10-14T10', 'Team Report Export', 10_000_000],
      ['casey', '2026-10-29T10', 'Team Report Export', 10_000_000],
      ['sam', '2026-10-14T12', 'Personal Report Export', 3_000_000],
      ['sam', '2026-10-29T12', 'Personal Report Export', 3_000_000],
      ['robin', '2026-10-16T09', 'Team Report Export', 5_000_000],
    ] as const) {
      const taskId = id + '-export-' + date.slice(0, 10);
      const started = date + ':04:00.000Z';
      const completed = date + ':05:00.000Z';
      task.run(taskId, id, scenario, started, completed);
      event.run(taskId + '-completed', id, taskId, 'task_completed', scenario, completed, completed);
      cost.run(taskId + '-run', id, taskId, started, completed, nanos);
      credit.run(taskId + '-debit', id, 'task_debit', taskId, -MEETING_NOTES_UNITS, completed);
    }
    const topup = db.prepare("INSERT INTO topups VALUES (?, ?, ?, 'USD', ?, ?, ?, ?)");
    const capture = db.prepare("INSERT INTO captures VALUES (?, ?, 'fixture-merchant', ?, 'USD', ?)");
    for (const [id, captured] of [
      ['jamie', '2026-10-12T11:00:00.000Z'],
      ['sam', '2026-10-14T14:00:00.000Z'],
      ['robin', '2026-10-16T11:00:00.000Z'],
    ] as const) {
      topup.run(id + '-topup', id, DEMO_TOPUP_CENTS, id + '-create', id + '-confirm', id + '-order', captured);
      capture.run(id + '-capture', id + '-topup', DEMO_TOPUP_CENTS, captured);
      credit.run(id + '-topup-grant', id, 'topup_grant', id + '-topup', TOPUP_GRANT_UNITS, captured);
    }
  });
} finally {
  db.close();
}
