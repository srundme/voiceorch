-- Agent Squads: teams, members, runs, steps, events + attach columns
-- Idempotent — safe to run multiple times / via the Railway SQL console.

CREATE TABLE IF NOT EXISTS "squads" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"supervisor_agent_id" integer,
	"entry_member_id" integer,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"handoff_greeting" text DEFAULT 'Hi — I''ve been briefed on your conversation so far. How can I help?',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squads" ADD CONSTRAINT "squads_supervisor_agent_id_agents_id_fk" FOREIGN KEY ("supervisor_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squads_user_id_idx" ON "squads" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squads_status_idx" ON "squads" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "squad_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"squad_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"role_name" text NOT NULL,
	"role_type" text DEFAULT 'specialist' NOT NULL,
	"instructions" text,
	"allowed_tools" jsonb DEFAULT '[]'::jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"handoff_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "squad_members_squad_agent_uidx" ON "squad_members" ("squad_id","agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_members_squad_id_idx" ON "squad_members" ("squad_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_members_agent_id_idx" ON "squad_members" ("agent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "squad_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"squad_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'task' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"active_member_id" integer,
	"active_call_id" integer,
	"campaign_id" integer,
	"campaign_lead_id" integer,
	"phone_number_id" integer,
	"triggered_by" text DEFAULT 'manual' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"billable_minutes" integer DEFAULT 0 NOT NULL,
	"final_result" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_runs" ADD CONSTRAINT "squad_runs_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_runs" ADD CONSTRAINT "squad_runs_active_member_id_squad_members_id_fk" FOREIGN KEY ("active_member_id") REFERENCES "public"."squad_members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_runs" ADD CONSTRAINT "squad_runs_active_call_id_calls_id_fk" FOREIGN KEY ("active_call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_runs_squad_id_idx" ON "squad_runs" ("squad_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_runs_user_status_idx" ON "squad_runs" ("user_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_runs_active_call_idx" ON "squad_runs" ("active_call_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_runs_campaign_lead_idx" ON "squad_runs" ("campaign_lead_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "squad_run_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"step_index" integer NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"member_id" integer,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"call_id" integer,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_run_steps" ADD CONSTRAINT "squad_run_steps_run_id_squad_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."squad_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_run_steps" ADD CONSTRAINT "squad_run_steps_member_id_squad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."squad_members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_run_steps" ADD CONSTRAINT "squad_run_steps_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_run_steps_run_idx" ON "squad_run_steps" ("run_id","step_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_run_steps_status_idx" ON "squad_run_steps" ("run_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "squad_run_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"type" text NOT NULL,
	"message" text,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_run_events" ADD CONSTRAINT "squad_run_events_run_id_squad_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."squad_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_run_events_run_created_idx" ON "squad_run_events" ("run_id","created_at");
--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN IF NOT EXISTS "squad_id" integer;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "squad_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phone_numbers_squad_id_idx" ON "phone_numbers" ("squad_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_squad_id_idx" ON "campaigns" ("squad_id");
