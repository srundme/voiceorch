-- Partner-managed clients get a full workspace (agents/KB/etc.).
-- Flip existing linked clients to allow_agent_edit and default new rows to true.
UPDATE "users"
SET "partner_allow_agent_edit" = true
WHERE "partner_id" IS NOT NULL
  AND "partner_allow_agent_edit" = false;

ALTER TABLE "users"
  ALTER COLUMN "partner_allow_agent_edit" SET DEFAULT true;
