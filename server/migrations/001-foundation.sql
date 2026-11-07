CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 password_hash TEXT NOT NULL, salt TEXT NOT NULL, settings TEXT NOT NULL,
 remind_at INTEGER NOT NULL, reminder_holder TEXT, reminder_lease INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), space TEXT NOT NULL CHECK(space IN ('real','demo')),
 payment_date TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 method TEXT NOT NULL CHECK(method IN ('Cash','UPI','Card')), additional_information TEXT NOT NULL DEFAULT '',
 transaction_ref TEXT NOT NULL DEFAULT '', request_key TEXT NOT NULL, purchase_id TEXT,
 tax_rate TEXT, version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(user_id,space,request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS expenses_reference ON expenses(user_id,space,lower(transaction_ref)) WHERE transaction_ref<>'';
CREATE INDEX IF NOT EXISTS expenses_dates ON expenses(user_id,space,payment_date);
CREATE TABLE IF NOT EXISTS audit_events (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), space TEXT NOT NULL,
 record_id TEXT NOT NULL, action TEXT NOT NULL, before_json TEXT, after_json TEXT, at INTEGER NOT NULL
);
