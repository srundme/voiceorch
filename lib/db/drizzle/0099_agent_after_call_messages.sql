-- Agent-owned after-call WhatsApp / email rules (universal + by disposition)
ALTER TABLE "agent_dispositions" ADD COLUMN IF NOT EXISTS "after_call_messages" jsonb;
