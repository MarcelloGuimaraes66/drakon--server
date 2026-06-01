ALTER TABLE public.job_step_agents
  ADD COLUMN IF NOT EXISTS use_temporal_context INTEGER NOT NULL DEFAULT 1;

UPDATE public.job_step_agents
SET use_temporal_context = CASE
  WHEN use_temporal_context IS NULL THEN 1
  WHEN use_temporal_context = 0 THEN 0
  ELSE 1
END;

-- Optional cleanup for agents already disabled.
-- Safe to run only if temporal columns already exist in this database.
-- UPDATE public.job_step_agents
-- SET temporal_plan_json = NULL,
--     temporal_plan_hash = NULL,
--     temporal_plan_version = NULL,
--     temporal_compiled_at = NULL,
--     temporal_compile_model = NULL,
--     temporal_explain_json = NULL
-- WHERE use_temporal_context = 0;
