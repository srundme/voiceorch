-- Direct Meta WhatsApp Cloud API connections (no BSP middleman).
-- Idempotent.

ALTER TABLE "whatsapp_connections"
  ADD COLUMN IF NOT EXISTS "meta_access_token" text,
  ADD COLUMN IF NOT EXISTS "meta_phone_number_id" text,
  ADD COLUMN IF NOT EXISTS "meta_waba_id" text,
  ADD COLUMN IF NOT EXISTS "meta_templates" jsonb DEFAULT '{}'::jsonb NOT NULL;
