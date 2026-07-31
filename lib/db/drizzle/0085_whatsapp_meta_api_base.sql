-- Optional Graph-compatible API base URL for Meta connections (BSP proxy panels).
-- Idempotent.

ALTER TABLE "whatsapp_connections"
  ADD COLUMN IF NOT EXISTS "meta_api_base" text;
