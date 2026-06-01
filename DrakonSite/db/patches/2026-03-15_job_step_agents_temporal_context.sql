ALTER TABLE job_step_agents
  ADD COLUMN IF NOT EXISTS use_temporal_context INTEGER NOT NULL DEFAULT 1;
