CREATE TABLE IF NOT EXISTS "user_cloned_voices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"cartesia_voice_id" text NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_cloned_voices_user_id_idx" ON "user_cloned_voices" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_cloned_voices_cartesia_voice_id_uidx" ON "user_cloned_voices" USING btree ("cartesia_voice_id");
