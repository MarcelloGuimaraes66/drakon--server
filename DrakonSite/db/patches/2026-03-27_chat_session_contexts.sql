CREATE TABLE IF NOT EXISTS chat_session_contexts (
  user_id TEXT NOT NULL,
  session_id INTEGER NOT NULL,
  compact_context_json TEXT NOT NULL DEFAULT '{}',
  last_compacted_message_id INTEGER NOT NULL DEFAULT 0,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  compacted_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_session_contexts_user_updated
  ON chat_session_contexts(user_id, updated_at DESC);
