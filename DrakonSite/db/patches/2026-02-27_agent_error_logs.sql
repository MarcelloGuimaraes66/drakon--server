BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_error_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  exe_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  occurred_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_error_logs_user_occurred
  ON public.agent_error_logs(user_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_agent_error_logs_user_client_occurred
  ON public.agent_error_logs(user_id, client_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_agent_error_logs_user_exe_occurred
  ON public.agent_error_logs(user_id, exe_id, occurred_at);

COMMIT;
