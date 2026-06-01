BEGIN;

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS timezone_iana TEXT,
  ADD COLUMN IF NOT EXISTS timezone_updated_at TIMESTAMP WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS timezone_source TEXT;

WITH latest_job_timezone AS (
  SELECT DISTINCT ON (j.user_id)
    j.user_id,
    NULLIF(TRIM(j.timezone), '') AS timezone_iana,
    COALESCE(j.updated_at, j.created_at, NOW()) AS tz_updated_at
  FROM public.jobs j
  WHERE j.timezone IS NOT NULL
    AND TRIM(j.timezone) <> ''
  ORDER BY j.user_id, COALESCE(j.updated_at, j.created_at, NOW()) DESC
)
UPDATE public.app_users au
SET timezone_iana = ljt.timezone_iana,
    timezone_updated_at = COALESCE(au.timezone_updated_at, ljt.tz_updated_at),
    timezone_source = COALESCE(au.timezone_source, 'backfill_jobs')
FROM latest_job_timezone ljt
WHERE au.id = ljt.user_id
  AND (au.timezone_iana IS NULL OR TRIM(au.timezone_iana) = '');

UPDATE public.app_users
SET timezone_iana = COALESCE(NULLIF(TRIM(timezone_iana), ''), 'UTC'),
    timezone_updated_at = COALESCE(timezone_updated_at, NOW()),
    timezone_source = COALESCE(timezone_source, 'default')
WHERE timezone_iana IS NULL
   OR TRIM(timezone_iana) = ''
   OR timezone_updated_at IS NULL
   OR timezone_source IS NULL;

ALTER TABLE public.app_users
  ALTER COLUMN timezone_iana SET DEFAULT 'UTC',
  ALTER COLUMN timezone_iana SET NOT NULL;

UPDATE public.jobs j
SET timezone = au.timezone_iana
FROM public.app_users au
WHERE au.id = j.user_id
  AND COALESCE(NULLIF(TRIM(j.timezone), ''), '__NULL__') <> au.timezone_iana;

COMMIT;
