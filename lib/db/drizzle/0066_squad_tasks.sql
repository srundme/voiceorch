CREATE TABLE IF NOT EXISTS "squad_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"squad_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"from_agent_id" integer,
	"to_agent_id" integer,
	"call_id" integer,
	"caller_phone" text,
	"title" text DEFAULT '' NOT NULL,
	"note" text,
	"context_summary" text,
	"due_at" timestamp with time zone,
	"scheduled_callback_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_tasks" ADD CONSTRAINT "squad_tasks_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_tasks" ADD CONSTRAINT "squad_tasks_from_agent_id_agents_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_tasks" ADD CONSTRAINT "squad_tasks_to_agent_id_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_tasks" ADD CONSTRAINT "squad_tasks_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_tasks_squad_created_idx" ON "squad_tasks" USING btree ("squad_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_tasks_user_status_idx" ON "squad_tasks" USING btree ("user_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_tasks_to_agent_idx" ON "squad_tasks" USING btree ("to_agent_id");
