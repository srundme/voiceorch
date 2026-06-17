-- Production schema sync: adds all tables and columns introduced after the
-- initial 0000 migration via drizzle-kit push (applied only to dev DB).
-- Every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so this is
-- idempotent and safe to run against any DB state.

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "snapserve_agent_id" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "context_window_turns" integer;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "token_summarization_enabled" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "token_summarization_threshold_turns" integer;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "staged_prompt_enabled" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "staged_prompt_stages" jsonb;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "staged_prompt_core_identity" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "inbound_phone_number_id" integer;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "outbound_phone_number_id" integer;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "first_speaker" text DEFAULT 'assistant';
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "tokens_saved" integer;
--> statement-breakpoint
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
