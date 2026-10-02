-- AI Test Calls: personas grounded in the agent's own prompt.
-- Test cases record which prompt facts/rules they probe and what the caller says;
-- one cached "agent brief" per agent, recomputed when the prompt/KB hash changes.

ALTER TABLE "simulation_test_cases" ADD COLUMN IF NOT EXISTS "targets" jsonb;
--> statement-breakpoint
ALTER TABLE "simulation_test_cases" ADD COLUMN IF NOT EXISTS "caller_facts" jsonb;
--> statement-breakpoint
ALTER TABLE "simulation_test_cases" ADD COLUMN IF NOT EXISTS "expected_outcome" text;
--> statement-breakpoint
ALTER TABLE "simulation_test_cases" ADD COLUMN IF NOT EXISTS "caller_role" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_test_agent_briefs" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" integer NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "input_hash" text NOT NULL,
  "brief" jsonb NOT NULL,
  "provider" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_test_agent_briefs_agent_uq" ON "ai_test_agent_briefs" ("agent_id");
