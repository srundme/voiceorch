CREATE TABLE IF NOT EXISTS "call_media" (
  "id" serial PRIMARY KEY NOT NULL,
  "call_id" integer,
  "agent_id" integer,
  "user_id" text,
  "phone" text,
  "source" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_name" text,
  "byte_size" integer NOT NULL,
  "image_data" bytea NOT NULL,
  "analysis_text" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_media" ADD CONSTRAINT "call_media_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_media" ADD CONSTRAINT "call_media_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_media_call_id_idx" ON "call_media" USING btree ("call_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_media_agent_phone_idx" ON "call_media" USING btree ("agent_id","phone");
