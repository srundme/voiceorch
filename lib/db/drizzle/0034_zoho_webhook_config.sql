ALTER TABLE "crm_connections" ADD COLUMN "webhook_secret" text;
ALTER TABLE "crm_connections" ADD COLUMN "webhook_campaign_id" integer;
ALTER TABLE "crm_connections" ADD COLUMN "webhook_agent_id" integer;
