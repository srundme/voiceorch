-- Partner can opt a managed client into editing/saving their own agents.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "partner_allow_agent_edit" boolean DEFAULT false NOT NULL;
