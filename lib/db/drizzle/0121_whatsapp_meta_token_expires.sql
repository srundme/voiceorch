-- Meta user-token expiry tracking (schema had the column; migration was missing).
-- Without this, SELECT on whatsapp_connections fails → GET /api/whatsapp/connections 500.

ALTER TABLE "whatsapp_connections"
  ADD COLUMN IF NOT EXISTS "meta_token_expires_at" timestamptz;
