CREATE TABLE IF NOT EXISTS "webcall_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "token" text NOT NULL,
  "label" text,
  "purpose" text,
  "active" boolean DEFAULT true NOT NULL,
  "require_camera" boolean DEFAULT false NOT NULL,
  "expires_at" timestamp with time zone,
  "max_uses" integer,
  "use_count" integer DEFAULT 0 NOT NULL,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webcall_links" ADD CONSTRAINT "webcall_links_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webcall_links_token_unique" ON "webcall_links" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webcall_links_agent_id_idx" ON "webcall_links" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webcall_links_user_id_idx" ON "webcall_links" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webcall_links_token_idx" ON "webcall_links" USING btree ("token");
