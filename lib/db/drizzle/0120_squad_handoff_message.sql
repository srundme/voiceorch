-- Customizable departing-agent announcement before live squad handoffs.
ALTER TABLE "squads"
  ADD COLUMN IF NOT EXISTS "handoff_message" text
  DEFAULT 'One moment — I''m connecting you to a teammate who can help with this.';

UPDATE "squads"
SET "handoff_message" = 'One moment — I''m connecting you to a teammate who can help with this.'
WHERE "handoff_message" IS NULL;
