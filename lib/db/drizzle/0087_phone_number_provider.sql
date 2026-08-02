ALTER TABLE "phone_numbers" ADD COLUMN IF NOT EXISTS "provider" text NOT NULL DEFAULT 'vobiz';
