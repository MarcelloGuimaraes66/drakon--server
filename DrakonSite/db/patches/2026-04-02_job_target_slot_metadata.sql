ALTER TABLE job_step_targets ADD COLUMN slot_key TEXT;
ALTER TABLE job_step_targets ADD COLUMN slot_label TEXT;

CREATE INDEX IF NOT EXISTS idx_job_step_targets_step_slot_key
ON job_step_targets(step_id, slot_key);
