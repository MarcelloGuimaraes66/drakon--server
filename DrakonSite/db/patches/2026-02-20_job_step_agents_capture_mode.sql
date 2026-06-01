ALTER TABLE job_step_agents
  ADD COLUMN IF NOT EXISTS only_capture_on_motion BOOLEAN NOT NULL DEFAULT TRUE;

