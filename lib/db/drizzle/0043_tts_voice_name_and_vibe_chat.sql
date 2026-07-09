ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "tts_voice_name" text;

CREATE TABLE IF NOT EXISTS "vibe_chat_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" integer,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vibe_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vibe_chat_sessions" ADD CONSTRAINT "vibe_chat_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vibe_chat_messages" ADD CONSTRAINT "vibe_chat_messages_session_id_vibe_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."vibe_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibe_chat_sessions_user_updated_idx" ON "vibe_chat_sessions" USING btree ("user_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibe_chat_sessions_agent_updated_idx" ON "vibe_chat_sessions" USING btree ("agent_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vibe_chat_messages_session_created_idx" ON "vibe_chat_messages" USING btree ("session_id","created_at");
