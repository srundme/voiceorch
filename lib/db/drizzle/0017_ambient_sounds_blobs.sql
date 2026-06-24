ALTER TABLE "ambient_sounds" ADD COLUMN IF NOT EXISTS "audio_data" "bytea";
--> statement-breakpoint
ALTER TABLE "ambient_sounds" ADD COLUMN IF NOT EXISTS "pcm_data" "bytea";
--> statement-breakpoint
ALTER TABLE "ambient_sounds" ALTER COLUMN "storage_key" DROP NOT NULL;
