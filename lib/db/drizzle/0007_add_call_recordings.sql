CREATE TABLE IF NOT EXISTS "call_recordings" (
	"id" serial PRIMARY KEY NOT NULL,
	"call_id" integer NOT NULL,
	"audio" "bytea" NOT NULL,
	"content_type" text DEFAULT 'audio/wav' NOT NULL,
	"byte_size" integer NOT NULL,
	"sample_rate" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_recordings_call_id_idx" ON "call_recordings" USING btree ("call_id");
