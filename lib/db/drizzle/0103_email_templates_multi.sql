-- Multi From identities + multi email templates (visual designer in-app).
CREATE TABLE IF NOT EXISTS "email_from_identities" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "from_name" text NOT NULL,
  "from_email" text NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_from_identities_user_id_idx" ON "email_from_identities" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "subject" text NOT NULL,
  "body_html" text NOT NULL,
  "design_json" jsonb,
  "from_identity_id" integer,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_templates_user_id_idx" ON "email_templates" ("user_id");
--> statement-breakpoint
ALTER TABLE "email_channels" ADD COLUMN IF NOT EXISTS "default_template_id" integer;
--> statement-breakpoint
ALTER TABLE "email_channels" ADD COLUMN IF NOT EXISTS "default_from_identity_id" integer;
--> statement-breakpoint
-- Seed identities + templates from existing channel from/default_template rows.
INSERT INTO "email_from_identities" ("user_id", "from_name", "from_email", "is_default")
SELECT
  c."user_id",
  COALESCE(NULLIF(TRIM(c."from_name"), ''), SPLIT_PART(c."from_email", '@', 1), 'Sender'),
  c."from_email",
  true
FROM "email_channels" c
WHERE c."from_email" IS NOT NULL
  AND TRIM(c."from_email") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "email_from_identities" i WHERE i."user_id" = c."user_id"
  );
--> statement-breakpoint
INSERT INTO "email_templates" ("user_id", "name", "subject", "body_html", "design_json", "is_default")
SELECT
  c."user_id",
  'Default follow-up',
  COALESCE(c."default_template"->>'subject', 'Thanks {{name}} — following up from our call'),
  COALESCE(c."default_template"->>'body', '<p>Hi {{name}},</p><p>{{summary}}</p>'),
  NULL,
  true
FROM "email_channels" c
WHERE NOT EXISTS (
  SELECT 1 FROM "email_templates" t WHERE t."user_id" = c."user_id"
);
--> statement-breakpoint
UPDATE "email_channels" c
SET
  "default_from_identity_id" = i."id",
  "default_template_id" = t."id"
FROM "email_from_identities" i, "email_templates" t
WHERE c."user_id" = i."user_id"
  AND c."user_id" = t."user_id"
  AND i."is_default" = true
  AND t."is_default" = true
  AND (c."default_from_identity_id" IS NULL OR c."default_template_id" IS NULL);
