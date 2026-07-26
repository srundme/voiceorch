-- WhatsApp-capable numbers share the phone_numbers table with voice DIDs;
-- `service` distinguishes them ('voice' default | 'whatsapp') for renewal
-- billing reuse while keeping them out of voice-only flows (agent assign, list).
ALTER TABLE "phone_numbers" ADD COLUMN IF NOT EXISTS "service" text NOT NULL DEFAULT 'voice';
