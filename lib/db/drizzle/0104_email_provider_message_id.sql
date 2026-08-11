-- Store Brevo's messageId so a send can be traced in Brevo transactional logs.
ALTER TABLE "email_messages" ADD COLUMN IF NOT EXISTS "provider_message_id" text;
