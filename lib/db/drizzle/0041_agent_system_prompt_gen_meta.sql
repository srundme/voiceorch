-- Migration: agents.system_prompt_gen_meta
-- Adds a jsonb column recording layered System Prompt Templates traceability
-- (Foundation version + Domain {id,name,version} + Client Details version +
-- form inputs + generatedAt) stamped when a layered-generated prompt is saved.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "system_prompt_gen_meta" jsonb;
