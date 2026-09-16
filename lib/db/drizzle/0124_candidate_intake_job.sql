ALTER TABLE "candidate_intakes"
  ADD COLUMN IF NOT EXISTS "skill_role" text,
  ADD COLUMN IF NOT EXISTS "skill" text,
  ADD COLUMN IF NOT EXISTS "industry" text,
  ADD COLUMN IF NOT EXISTS "qualification" text,
  ADD COLUMN IF NOT EXISTS "shift_base" text,
  ADD COLUMN IF NOT EXISTS "dnd" text;
