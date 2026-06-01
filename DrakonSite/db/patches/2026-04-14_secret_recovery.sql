CREATE TABLE IF NOT EXISTS user_secret_recovery (
  app_user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  storage_scope TEXT NOT NULL DEFAULT 'local',
  question_key TEXT,
  answer_hash TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  configured_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_secret_recovery_locked_until
  ON user_secret_recovery(locked_until);
