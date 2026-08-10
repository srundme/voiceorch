-- Mid-call fact candidates (verification-gated pipeline §2).
-- Regex / fast latches stage here; call-end extraction writes caller_facts.
CREATE TABLE IF NOT EXISTS "pending_caller_facts" (
  "id" serial PRIMARY KEY NOT NULL,
  "call_id" integer NOT NULL REFERENCES "calls"("id") ON DELETE cascade,
  "agent_id" integer NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "phone_number" text NOT NULL,
  "key" text NOT NULL,
  "value_raw" text NOT NULL,
  "source_sentence_id" integer,
  "method" text DEFAULT 'regex' NOT NULL,
  "confidence" real DEFAULT 0.4 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_caller_facts_call_idx"
  ON "pending_caller_facts" ("call_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_caller_facts_lookup_idx"
  ON "pending_caller_facts" ("agent_id", "phone_number", "call_id");
