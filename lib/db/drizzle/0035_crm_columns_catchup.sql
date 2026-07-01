ALTER TABLE "crm_connections" ADD COLUMN IF NOT EXISTS "webhook_secret" text;
ALTER TABLE "crm_connections" ADD COLUMN IF NOT EXISTS "webhook_campaign_id" integer;
ALTER TABLE "crm_connections" ADD COLUMN IF NOT EXISTS "webhook_agent_id" integer;
