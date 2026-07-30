ALTER TABLE "user_cloned_voices" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'cartesia' NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "user_cloned_voices_cartesia_voice_id_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_cloned_voices_provider_voice_uidx" ON "user_cloned_voices" USING btree ("provider", "cartesia_voice_id");
