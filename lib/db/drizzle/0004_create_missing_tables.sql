-- Creates tables that were added to the schema after the initial push but never
-- had a migration. All statements use IF NOT EXISTS / duplicate_object guards.

CREATE TABLE IF NOT EXISTS "agent_knowledge_sources" (
        "agent_id" integer NOT NULL,
        "source_id" integer NOT NULL,
        CONSTRAINT "agent_ks_pk" PRIMARY KEY("agent_id","source_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_knowledge_sources" ADD CONSTRAINT "agent_knowledge_sources_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_knowledge_sources" ADD CONSTRAINT "agent_knowledge_sources_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_dispositions" (
        "agent_id" integer PRIMARY KEY NOT NULL,
        "taxonomy" jsonb NOT NULL,
        "domain_fields" jsonb DEFAULT '[]'::jsonb,
        "rules" jsonb DEFAULT '[]'::jsonb,
        "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_dispositions" ADD CONSTRAINT "agent_dispositions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "call_dispositions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "agent_id" integer,
        "call_id" integer,
        "transcript" text,
        "call_events" jsonb,
        "result" jsonb,
        "needs_review" boolean DEFAULT false,
        "human_correction" jsonb,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_dispositions" ADD CONSTRAINT "call_dispositions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_dispositions" ADD CONSTRAINT "call_dispositions_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "call_events" (
        "id" serial PRIMARY KEY NOT NULL,
        "call_id" integer NOT NULL,
        "ts" timestamp with time zone DEFAULT now() NOT NULL,
        "level" text DEFAULT 'info' NOT NULL,
        "event" text NOT NULL,
        "data" json
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_events_call_id_idx" ON "call_events" USING btree ("call_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_events" ADD CONSTRAINT "call_events_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "execution_logs" (
        "id" serial PRIMARY KEY NOT NULL,
        "call_id" integer NOT NULL,
        "agent_id" integer,
        "ts" timestamp with time zone DEFAULT now() NOT NULL,
        "component" text NOT NULL,
        "provider" text,
        "direction" text NOT NULL,
        "status" text DEFAULT 'info' NOT NULL,
        "latency_ms" integer,
        "request_payload" json,
        "response_payload" json,
        "metadata" json
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_logs_call_id_idx" ON "execution_logs" USING btree ("call_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_logs_ts_idx" ON "execution_logs" USING btree ("ts");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_versions" (
        "id" serial PRIMARY KEY NOT NULL,
        "agent_id" integer NOT NULL,
        "user_id" text NOT NULL,
        "version_number" text NOT NULL,
        "version_name" text NOT NULL,
        "commit_description" text NOT NULL,
        "release_notes" text,
        "status" text DEFAULT 'draft' NOT NULL,
        "snapshot" jsonb NOT NULL,
        "changed_fields" jsonb,
        "published_by" text,
        "restored_from_version_id" integer,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "simulation_test_cases" (
        "id" serial PRIMARY KEY NOT NULL,
        "agent_id" integer NOT NULL,
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
DO $$ BEGIN
 ALTER TABLE "simulation_test_cases" ADD CONSTRAINT "simulation_test_cases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "simulation_runs" (
        "id" serial PRIMARY KEY NOT NULL,
        "agent_id" integer NOT NULL,
        "test_case_id" integer,
        "user_id" text NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "score" integer,
        "result" jsonb,
        "started_at" timestamp with time zone,
        "completed_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_test_case_id_simulation_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."simulation_test_cases"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "simulation_messages" (
        "id" serial PRIMARY KEY NOT NULL,
        "simulation_run_id" integer NOT NULL,
        "role" text NOT NULL,
        "content" text NOT NULL,
        "metadata" jsonb,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "simulation_messages" ADD CONSTRAINT "simulation_messages_simulation_run_id_simulation_runs_id_fk" FOREIGN KEY ("simulation_run_id") REFERENCES "public"."simulation_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
