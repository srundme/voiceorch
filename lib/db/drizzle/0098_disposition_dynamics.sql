-- Disposition meaning map (agent) + campaign after-call branches
ALTER TABLE "agent_dispositions" ADD COLUMN IF NOT EXISTS "meaning_map" jsonb;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "after_call_branches" json;
