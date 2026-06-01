BEGIN;

ALTER TABLE public.agent_error_logs
  ADD COLUMN IF NOT EXISTS flow TEXT;

ALTER TABLE public.agent_error_logs
  ADD COLUMN IF NOT EXISTS function_name TEXT;

ALTER TABLE public.agent_error_logs
  ADD COLUMN IF NOT EXISTS operation TEXT;

ALTER TABLE public.agent_error_logs
  ADD COLUMN IF NOT EXISTS context_json TEXT;

COMMIT;
