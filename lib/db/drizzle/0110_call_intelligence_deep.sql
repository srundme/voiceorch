-- Deep campaign call intelligence signals (purchase intent, emotion, agent performance).
ALTER TABLE "call_executions" ADD COLUMN IF NOT EXISTS "purchase_intent_score" integer;
ALTER TABLE "call_executions" ADD COLUMN IF NOT EXISTS "urgency" text;
ALTER TABLE "call_executions" ADD COLUMN IF NOT EXISTS "objections" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "call_executions" ADD COLUMN IF NOT EXISTS "buying_signals" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "call_executions" ADD COLUMN IF NOT EXISTS "next_best_action" text;
ALTER TABLE "call_executions" ADD COLUMN IF NOT EXISTS "emotion" text;
ALTER TABLE "call_executions" ADD COLUMN IF NOT EXISTS "agent_performance" jsonb;

CREATE INDEX IF NOT EXISTS "call_executions_purchase_intent_idx" ON "call_executions" ("purchase_intent_score");
