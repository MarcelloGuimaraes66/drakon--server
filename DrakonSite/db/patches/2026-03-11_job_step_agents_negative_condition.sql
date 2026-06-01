ALTER TABLE public.job_step_agents
  ADD COLUMN IF NOT EXISTS negative_condition text;
