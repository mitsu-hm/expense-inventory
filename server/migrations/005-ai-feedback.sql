CREATE TABLE IF NOT EXISTS ai_feedback (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 space TEXT NOT NULL CHECK(space IN ('real','demo')),
 document_id TEXT NOT NULL UNIQUE REFERENCES documents(id),
 kind TEXT NOT NULL CHECK(kind IN ('bill','payment_receipt','order')),
 extracted_json TEXT NOT NULL,
 confirmed_json TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_feedback_lookup ON ai_feedback(user_id,space,kind,created_at DESC);

