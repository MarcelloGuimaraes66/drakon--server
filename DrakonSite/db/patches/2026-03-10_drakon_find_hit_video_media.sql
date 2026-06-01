BEGIN;

ALTER TABLE public.drakon_find_hits
  ADD COLUMN IF NOT EXISTS video_key text;

ALTER TABLE public.drakon_find_hits
  ADD COLUMN IF NOT EXISTS video_url text;

COMMIT;
