BEGIN;

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS handle TEXT;

UPDATE public.app_users
SET handle = split_part(email, '@', 1)
WHERE (handle IS NULL OR btrim(handle) = '')
  AND email IS NOT NULL
  AND position('@' in email) > 1;

COMMIT;
