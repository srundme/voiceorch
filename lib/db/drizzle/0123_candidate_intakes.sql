CREATE TABLE IF NOT EXISTS "candidate_intakes" (
  "id" serial PRIMARY KEY,
  "public_token" text NOT NULL UNIQUE,
  "user_id" text,
  "agent_id" integer REFERENCES "agents"("id") ON DELETE SET NULL,
  "call_id" integer REFERENCES "calls"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'in_progress',
  "first_name" text,
  "last_name" text,
  "phone" text,
  "email" text,
  "gender" text,
  "date_of_birth" date,
  "work_status" text,
  "total_companies" integer,
  "city" text,
  "job_city" text,
  "english_communication" text,
  "skill_role" text,
  "skill" text,
  "industry" text,
  "qualification" text,
  "shift_base" text,
  "dnd" text,
  "extra" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "revision" integer NOT NULL DEFAULT 0,
  "last_field_key" text,
  "last_write_source" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "candidate_intakes_user_id_idx" ON "candidate_intakes" ("user_id");
CREATE INDEX IF NOT EXISTS "candidate_intakes_agent_id_idx" ON "candidate_intakes" ("agent_id");
CREATE INDEX IF NOT EXISTS "candidate_intakes_call_id_idx" ON "candidate_intakes" ("call_id");
CREATE INDEX IF NOT EXISTS "candidate_intakes_status_idx" ON "candidate_intakes" ("status");
