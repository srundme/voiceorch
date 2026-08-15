ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "analytics_questions" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "call_executions" ADD COLUMN IF NOT EXISTS "analytics_answers" jsonb DEFAULT '{}'::jsonb;
