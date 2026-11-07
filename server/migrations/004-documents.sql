CREATE TABLE IF NOT EXISTS documents (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),space TEXT NOT NULL CHECK(space IN ('real','demo')),
 kind TEXT NOT NULL CHECK(kind IN ('bill','payment_receipt','order')),name TEXT NOT NULL,mime_type TEXT NOT NULL,content BLOB NOT NULL,sha256 TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed')),processing TEXT NOT NULL,draft_json TEXT NOT NULL,extracted_json TEXT,last_error TEXT,
 version INTEGER NOT NULL DEFAULT 1,expense_id TEXT REFERENCES expenses(id),purchase_id TEXT REFERENCES purchases(id),confirmed_target TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 UNIQUE(user_id,space,sha256)
);
CREATE INDEX IF NOT EXISTS document_expenses ON documents(user_id,space,expense_id);
