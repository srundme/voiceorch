-- AI Test Calls: AI-to-AI testing over real phone calls.
-- Hidden caller persona agents, test-leg flags on calls, and the existing
-- simulation_* tables extended for real-phone runs. All statements idempotent.

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "is_test_persona" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "test_run_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calls_test_run_id_idx" ON "calls" ("test_run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "simulation_test_cases" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" integer NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "persona_prompt" text NOT NULL,
  "goal" text NOT NULL,
  "success_criteria" text[] DEFAULT '{}' NOT NULL,
  "variables" jsonb,
  "kb_source_id" integer,
  "max_turns" integer DEFAULT 20 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "simulation_test_cases" ADD COLUMN IF NOT EXISTS "language" text;
--> statement-breakpoint
ALTER TABLE "simulation_test_cases" ADD COLUMN IF NOT EXISTS "difficulty" text;
--> statement-breakpoint
ALTER TABLE "simulation_test_cases" ADD COLUMN IF NOT EXISTS "scenario" text;
--> statement-breakpoint
ALTER TABLE "simulation_test_cases" ADD COLUMN IF NOT EXISTS "caller_gender" text;
--> statement-breakpoint
ALTER TABLE "simulation_test_cases" ADD COLUMN IF NOT EXISTS "max_duration_seconds" integer DEFAULT 300 NOT NULL;
--> statement-breakpoint
ALTER TABLE "simulation_test_cases" ADD COLUMN IF NOT EXISTS "created_by" text;
--> statement-breakpoint
ALTER TABLE "simulation_test_cases" ADD COLUMN IF NOT EXISTS "archived" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "simulation_test_cases" ADD COLUMN IF NOT EXISTS "caller_agent_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "simulation_test_cases_agent_idx" ON "simulation_test_cases" ("agent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "simulation_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" integer NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "test_case_id" integer REFERENCES "simulation_test_cases"("id") ON DELETE SET NULL,
  "user_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "score" integer,
  "result" jsonb,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN IF NOT EXISTS "batch_id" text;
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN IF NOT EXISTS "caller_agent_id" integer;
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN IF NOT EXISTS "caller_call_id" integer;
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN IF NOT EXISTS "callee_call_id" integer;
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN IF NOT EXISTS "target_number" text;
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN IF NOT EXISTS "caller_from_number" text;
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN IF NOT EXISTS "dial_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN IF NOT EXISTS "verdict" text;
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN IF NOT EXISTS "error" text;
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN IF NOT EXISTS "cost_cents" integer;
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN IF NOT EXISTS "test_case_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN IF NOT EXISTS "created_by" text;
--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "simulation_runs_agent_created_idx" ON "simulation_runs" ("agent_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "simulation_runs_status_idx" ON "simulation_runs" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "simulation_runs_callee_call_uq" ON "simulation_runs" ("callee_call_id") WHERE "callee_call_id" IS NOT NULL;
