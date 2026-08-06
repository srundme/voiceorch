ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "meet_bot_id" text;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "meet_bot_join_at" timestamp with time zone;
