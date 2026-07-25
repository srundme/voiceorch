-- Rebuild call_media table (cleaner schema with analysis cache, url_ref, retention)
CREATE TABLE IF NOT EXISTS "call_media" (
  "id"              serial PRIMARY KEY NOT NULL,
  "call_id"         integer,
  "agent_id"        integer,
  "user_id"         text,
  "phone"           text,
  "source"          text NOT NULL,
  "mime_type"       text NOT NULL,
  "file_name"       text,
  "byte_size"       integer NOT NULL DEFAULT 0,
  "image_data"      bytea,
  "url_ref"         text,
  "analysis_cache"  jsonb DEFAULT '{}',
  "retention_days"  integer,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "call_media" ADD CONSTRAINT "call_media_call_id_calls_id_fk"
    FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "call_media" ADD CONSTRAINT "call_media_agent_id_agents_id_fk"
    FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_media_call_id_idx"       ON "call_media" USING btree ("call_id");
CREATE INDEX IF NOT EXISTS "call_media_agent_phone_idx"   ON "call_media" USING btree ("agent_id","phone");
CREATE INDEX IF NOT EXISTS "call_media_agent_staged_idx"  ON "call_media" USING btree ("agent_id","source");

-- Per-vision-agent custom database schemas
CREATE TABLE IF NOT EXISTS "vision_agent_db_schemas" (
  "id"          serial PRIMARY KEY NOT NULL,
  "agent_id"    integer NOT NULL,
  "user_id"     text NOT NULL,
  "name"        text NOT NULL,
  "description" text,
  "fields"      jsonb NOT NULL DEFAULT '[]',
  "writeable"   boolean NOT NULL DEFAULT true,
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"  timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vision_agent_db_schemas" ADD CONSTRAINT "vadb_schema_agent_id_fk"
    FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vadb_schema_agent_idx" ON "vision_agent_db_schemas" USING btree ("agent_id");

-- Per-vision-agent custom database records
CREATE TABLE IF NOT EXISTS "vision_agent_db_records" (
  "id"         serial PRIMARY KEY NOT NULL,
  "schema_id"  integer NOT NULL,
  "agent_id"   integer NOT NULL,
  "data"       jsonb NOT NULL DEFAULT '{}',
  "call_id"    integer,
  "phone"      text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vision_agent_db_records" ADD CONSTRAINT "vadb_record_schema_id_fk"
    FOREIGN KEY ("schema_id") REFERENCES "public"."vision_agent_db_schemas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vision_agent_db_records" ADD CONSTRAINT "vadb_record_agent_id_fk"
    FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vadb_record_schema_idx" ON "vision_agent_db_records" USING btree ("schema_id");
CREATE INDEX IF NOT EXISTS "vadb_record_agent_idx"  ON "vision_agent_db_records" USING btree ("agent_id");

-- Vision connections (external API / webhook / database)
CREATE TABLE IF NOT EXISTS "vision_connections" (
  "id"           serial PRIMARY KEY NOT NULL,
  "agent_id"     integer NOT NULL,
  "user_id"      text NOT NULL,
  "name"         text NOT NULL,
  "description"  text,
  "type"         text NOT NULL,
  "active"       boolean NOT NULL DEFAULT true,
  "config"       jsonb NOT NULL DEFAULT '{}',
  "last_used_at" timestamp with time zone,
  "last_error"   text,
  "created_at"   timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"   timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vision_connections" ADD CONSTRAINT "vision_conn_agent_id_fk"
    FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vision_conn_agent_idx" ON "vision_connections" USING btree ("agent_id");
