ALTER TABLE public.drakon_find_searches
  ADD COLUMN IF NOT EXISTS runtime_mode text NOT NULL DEFAULT 'continuous_video_60s';

ALTER TABLE public.drakon_find_searches
  ADD COLUMN IF NOT EXISTS input_type text NOT NULL DEFAULT 'video';

ALTER TABLE public.drakon_find_searches
  ADD COLUMN IF NOT EXISTS window_seconds integer NOT NULL DEFAULT 60;

ALTER TABLE public.drakon_find_searches
  ADD COLUMN IF NOT EXISTS duration_seconds integer NOT NULL DEFAULT 1800;

ALTER TABLE public.drakon_find_searches
  ADD COLUMN IF NOT EXISTS run_until text;

UPDATE public.drakon_find_searches
SET runtime_mode = COALESCE(NULLIF(btrim(runtime_mode), ''), 'continuous_video_60s');

UPDATE public.drakon_find_searches
SET input_type = COALESCE(NULLIF(btrim(input_type), ''), 'video');

UPDATE public.drakon_find_searches
SET window_seconds = 60
WHERE window_seconds IS NULL OR window_seconds <= 0;

UPDATE public.drakon_find_searches
SET duration_seconds = 1800
WHERE duration_seconds IS NULL OR duration_seconds < 1800;

UPDATE public.drakon_find_searches
SET run_until = COALESCE(run_until, completed_at, cancelled_at, updated_at, created_at)
WHERE run_until IS NULL;
