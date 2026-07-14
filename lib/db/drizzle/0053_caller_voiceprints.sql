CREATE TABLE IF NOT EXISTS "caller_voiceprints" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" integer NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "person_key" text NOT NULL,
  "phone_number" text NOT NULL,
  "embedding" jsonb NOT NULL,
  "display_name" text,
  "match_count" integer DEFAULT 1 NOT NULL,
  "last_score" real,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "caller_voiceprints_agent_phone_uidx"
  ON "caller_voiceprints" ("agent_id", "phone_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caller_voiceprints_agent_person_idx"
  ON "caller_voiceprints" ("agent_id", "person_key");
