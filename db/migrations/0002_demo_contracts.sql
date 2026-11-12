-- ABOUTME: Defines the shared Word of Fit identity, payment, credit, and imported facts.
-- ABOUTME: Money uses exact integer USD cents or nanos. Synthetic facts use a separate database.

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    referrer_id TEXT REFERENCES users(id),
    registered_at TEXT NOT NULL,
    CHECK (referrer_id IS NULL OR referrer_id <> id)
) STRICT;

CREATE TRIGGER users_referrer_immutable
BEFORE UPDATE OF referrer_id ON users
WHEN NEW.referrer_id IS NOT OLD.referrer_id
BEGIN
    SELECT RAISE(ABORT, 'Referral attribution is locked at registration');
END;

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('user', 'founder')),
    user_id TEXT REFERENCES users(id),
    expires_at TEXT NOT NULL,
    CHECK (
        (role = 'user' AND user_id IS NOT NULL)
        OR (role = 'founder' AND user_id IS NULL)
    )
) STRICT;

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    scenario TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    result TEXT,
    UNIQUE (id, user_id)
) STRICT;

CREATE TABLE topups (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL CHECK (currency = 'USD'),
    create_key TEXT NOT NULL UNIQUE,
    capture_key TEXT NOT NULL UNIQUE,
    paypal_order_id TEXT UNIQUE,
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE captures (
    id TEXT PRIMARY KEY,
    topup_id TEXT NOT NULL UNIQUE REFERENCES topups(id),
    merchant_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL CHECK (currency = 'USD'),
    occurred_at TEXT NOT NULL
) STRICT;

CREATE TABLE refunds (
    id TEXT PRIMARY KEY,
    capture_id TEXT NOT NULL REFERENCES captures(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL CHECK (currency = 'USD'),
    occurred_at TEXT NOT NULL
) STRICT;

CREATE TABLE webhook_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    received_at TEXT NOT NULL
) STRICT;

CREATE TABLE webhook_deliveries (
    transmission_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES webhook_events(id),
    received_at TEXT NOT NULL
) STRICT;

CREATE TABLE credit_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('trial_grant', 'task_debit', 'topup_grant')),
    reference_id TEXT NOT NULL,
    units INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    UNIQUE (kind, reference_id),
    CHECK (
        (kind = 'task_debit' AND units < 0)
        OR (kind IN ('trial_grant', 'topup_grant') AND units > 0)
    )
) STRICT;

CREATE TABLE behavior_events (
    project_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    task_id TEXT,
    event_name TEXT NOT NULL,
    scenario TEXT,
    occurred_at TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (project_id, event_id),
    FOREIGN KEY (task_id, user_id) REFERENCES tasks(id, user_id)
) STRICT;

CREATE TABLE model_costs (
    project_id TEXT NOT NULL,
    source TEXT NOT NULL,
    run_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    task_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    amount_usd_nanos INTEGER CHECK (amount_usd_nanos >= 0),
    cost_status TEXT NOT NULL CHECK (cost_status IN ('reported', 'estimated', 'missing')),
    PRIMARY KEY (project_id, source, run_id),
    FOREIGN KEY (task_id, user_id) REFERENCES tasks(id, user_id),
    CHECK ((cost_status = 'missing') = (amount_usd_nanos IS NULL))
) STRICT;

CREATE INDEX users_referral_cohort ON users(referrer_id, registered_at);
CREATE INDEX tasks_user_time ON tasks(user_id, started_at);
CREATE INDEX topups_user_time ON topups(user_id, created_at);
CREATE INDEX refunds_capture ON refunds(capture_id);
CREATE INDEX credit_entries_user_time ON credit_entries(user_id, occurred_at);
CREATE INDEX behavior_events_user_time ON behavior_events(user_id, occurred_at);
CREATE INDEX model_costs_user_time ON model_costs(user_id, occurred_at);
