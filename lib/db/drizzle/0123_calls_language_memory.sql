-- Analytics columns referenced by the calls schema and outbound INSERT RETURNING.
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "primary_language" text;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "memory_recognized" boolean;
