-- SQLite note:
-- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` is not available in many SQLite environments.
-- Run the PRAGMA first. If `use_temporal_context` is already listed, skip the ALTER TABLE.

PRAGMA table_info(job_step_agents);

ALTER TABLE job_step_agents
  ADD COLUMN use_temporal_context INTEGER NOT NULL DEFAULT 1;

UPDATE job_step_agents
SET use_temporal_context = COALESCE(use_temporal_context, 1);

-- Optional cleanup for agents already disabled.
-- Safe to run only if temporal columns already exist in this database.
-- UPDATE job_step_agents
-- SET temporal_plan_json = NULL,
--     temporal_plan_hash = NULL,
--     temporal_plan_version = NULL,
--     temporal_compiled_at = NULL,
--     temporal_compile_model = NULL,
--     temporal_explain_json = NULL
-- WHERE use_temporal_context = 0;
