ALTER TABLE "scheduled_callbacks"
  ADD COLUMN IF NOT EXISTS "triggered_call_id" integer REFERENCES "calls"("id") ON DELETE SET NULL;
