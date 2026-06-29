ALTER TABLE "calls" ALTER COLUMN "resume_context" TYPE jsonb USING resume_context::text::jsonb;
