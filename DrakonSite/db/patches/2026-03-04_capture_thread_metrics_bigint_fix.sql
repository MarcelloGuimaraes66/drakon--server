BEGIN;

ALTER TABLE public.capture_thread_metrics_latest
  ALTER COLUMN capture_mem_estimated_bytes TYPE BIGINT USING capture_mem_estimated_bytes::BIGINT,
  ALTER COLUMN process_working_set_bytes TYPE BIGINT USING process_working_set_bytes::BIGINT,
  ALTER COLUMN process_private_bytes TYPE BIGINT USING process_private_bytes::BIGINT;

COMMIT;
