CREATE TABLE IF NOT EXISTS "agent_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" integer NOT NULL,
	"title" text NOT NULL,
	"goal" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"dial_policy" text DEFAULT 'approval' NOT NULL,
	"prefs" jsonb DEFAULT '{}'::jsonb,
	"result_summary" text,
	"error_message" text,
	"dial_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_task_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_task_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"step_index" integer NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"result" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_task_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"address" text,
	"source_url" text,
	"place_id" text,
	"rank" integer DEFAULT 0 NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_task_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"call_id" integer,
	"candidate_id" integer,
	"to_number" text NOT NULL,
	"outcome" text,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_task_messages" ADD CONSTRAINT "agent_task_messages_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_task_steps" ADD CONSTRAINT "agent_task_steps_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_task_candidates" ADD CONSTRAINT "agent_task_candidates_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_task_calls" ADD CONSTRAINT "agent_task_calls_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_task_calls" ADD CONSTRAINT "agent_task_calls_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_task_calls" ADD CONSTRAINT "agent_task_calls_candidate_id_agent_task_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."agent_task_candidates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_user_updated_idx" ON "agent_tasks" USING btree ("user_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_user_status_idx" ON "agent_tasks" USING btree ("user_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_agent_updated_idx" ON "agent_tasks" USING btree ("agent_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_task_messages_task_created_idx" ON "agent_task_messages" USING btree ("task_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_task_steps_task_idx" ON "agent_task_steps" USING btree ("task_id","step_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_task_candidates_task_rank_idx" ON "agent_task_candidates" USING btree ("task_id","rank");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_task_calls_task_idx" ON "agent_task_calls" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_task_calls_call_idx" ON "agent_task_calls" USING btree ("call_id");
