BEGIN;

CREATE TABLE IF NOT EXISTS public.capture_thread_metrics_latest (
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  exe_id TEXT NOT NULL,
  camera_id INTEGER NOT NULL,
  thread_name TEXT NOT NULL,
  cpu_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  capture_mem_estimated_bytes BIGINT NOT NULL DEFAULT 0,
  process_working_set_bytes BIGINT NOT NULL DEFAULT 0,
  process_private_bytes BIGINT NOT NULL DEFAULT 0,
  queue_depth INTEGER NOT NULL DEFAULT 0,
  sampled_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  PRIMARY KEY (user_id, client_id, camera_id, thread_name)
);

CREATE INDEX IF NOT EXISTS idx_capture_metrics_latest_user_camera
  ON public.capture_thread_metrics_latest(user_id, camera_id);

CREATE INDEX IF NOT EXISTS idx_capture_metrics_latest_user_updated
  ON public.capture_thread_metrics_latest(user_id, updated_at);

ALTER TABLE public.exe_pairings
  ADD COLUMN IF NOT EXISTS timezone_iana TEXT,
  ADD COLUMN IF NOT EXISTS timezone_updated_at TIMESTAMP WITHOUT TIME ZONE;

DO $$
DECLARE
  pk_name TEXT;
  pk_is_user_only BOOLEAN := FALSE;
BEGIN
  SELECT tc.constraint_name
    INTO pk_name
  FROM information_schema.table_constraints tc
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'exe_pairings'
    AND tc.constraint_type = 'PRIMARY KEY'
  LIMIT 1;

  IF pk_name IS NOT NULL THEN
    SELECT TRUE
      INTO pk_is_user_only
    FROM information_schema.key_column_usage k
    WHERE k.table_schema = 'public'
      AND k.table_name = 'exe_pairings'
      AND k.constraint_name = pk_name
    GROUP BY k.constraint_name
    HAVING COUNT(*) = 1
       AND MAX(k.column_name) = 'user_id';

    pk_is_user_only := COALESCE(pk_is_user_only, FALSE);
  END IF;

  IF pk_name IS NULL THEN
    ALTER TABLE public.exe_pairings
      ADD CONSTRAINT exe_pairings_pkey PRIMARY KEY (user_id, client_id);
  ELSIF pk_is_user_only THEN
    EXECUTE format('ALTER TABLE public.exe_pairings DROP CONSTRAINT %I', pk_name);
    ALTER TABLE public.exe_pairings
      ADD CONSTRAINT exe_pairings_pkey PRIMARY KEY (user_id, client_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_exe_pairings_user_status
  ON public.exe_pairings(user_id, status);

CREATE INDEX IF NOT EXISTS idx_exe_pairings_client_token_status
  ON public.exe_pairings(client_id, exe_token_hash, status);

CREATE INDEX IF NOT EXISTS idx_exe_pairings_user_last_seen
  ON public.exe_pairings(user_id, last_seen_at);

COMMIT;
