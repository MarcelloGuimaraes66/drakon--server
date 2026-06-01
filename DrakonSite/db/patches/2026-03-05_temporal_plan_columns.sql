ALTER TABLE camera_algorithms
  ADD COLUMN IF NOT EXISTS temporal_plan_json TEXT;

ALTER TABLE camera_algorithms
  ADD COLUMN IF NOT EXISTS temporal_plan_hash TEXT;

ALTER TABLE camera_algorithms
  ADD COLUMN IF NOT EXISTS temporal_plan_version TEXT;

ALTER TABLE camera_algorithms
  ADD COLUMN IF NOT EXISTS temporal_compiled_at TEXT;

ALTER TABLE camera_algorithms
  ADD COLUMN IF NOT EXISTS temporal_compile_model TEXT;

ALTER TABLE camera_algorithms
  ADD COLUMN IF NOT EXISTS temporal_explain_json TEXT;

ALTER TABLE job_step_agents
  ADD COLUMN IF NOT EXISTS temporal_plan_json TEXT;

ALTER TABLE job_step_agents
  ADD COLUMN IF NOT EXISTS temporal_plan_hash TEXT;

ALTER TABLE job_step_agents
  ADD COLUMN IF NOT EXISTS temporal_plan_version TEXT;

ALTER TABLE job_step_agents
  ADD COLUMN IF NOT EXISTS temporal_compiled_at TEXT;

ALTER TABLE job_step_agents
  ADD COLUMN IF NOT EXISTS temporal_compile_model TEXT;

ALTER TABLE job_step_agents
  ADD COLUMN IF NOT EXISTS temporal_explain_json TEXT;
