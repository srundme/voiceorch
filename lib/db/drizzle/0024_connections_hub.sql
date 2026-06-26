-- Connections Hub: HMAC secret + webhook status tracking on campaigns,
-- and Meta app-secret support for signature verification.

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "hmac_secret" text,
  ADD COLUMN IF NOT EXISTS "last_webhook_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_webhook_status" text;
--> statement-breakpoint
ALTER TABLE "meta_integrations"
  ADD COLUMN IF NOT EXISTS "app_secret_encrypted" text;
