BEGIN;

CREATE TABLE IF NOT EXISTS public.openai_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  api_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT openai_settings_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_openai_settings_user_id
  ON public.openai_settings(user_id);

COMMIT;
