-- Per-outcome business definitions for disposition LLM (e.g. what "interested" means).
ALTER TABLE agent_dispositions
  ADD COLUMN IF NOT EXISTS outcome_guides jsonb DEFAULT '{}'::jsonb;
