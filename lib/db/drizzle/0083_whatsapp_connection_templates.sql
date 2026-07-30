-- BSP adopter: map SnapServe hints → template names created in the user's BSP.
-- Idempotent.

ALTER TABLE "whatsapp_connections"
  ADD COLUMN IF NOT EXISTS "templates" jsonb DEFAULT '{}'::jsonb NOT NULL;
