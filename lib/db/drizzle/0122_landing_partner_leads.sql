CREATE TABLE IF NOT EXISTS "landing_partner_leads" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "company" text,
  "website" text,
  "role" text,
  "message" text,
  "source" text NOT NULL DEFAULT 'landing',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "landing_partner_leads_created_idx" ON "landing_partner_leads" ("created_at");
CREATE INDEX IF NOT EXISTS "landing_partner_leads_email_idx" ON "landing_partner_leads" ("email");
