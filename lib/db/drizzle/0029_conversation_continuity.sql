ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "conversation_completed" boolean;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "resume_context" json;
