-- Migration: System Prompt Templates (Foundation + dynamic Domains + Client Details)
-- Adds a NEW, separate template store alongside the legacy `prompt_templates`
-- table. The legacy master template continues to power live agent generation
-- untouched; this store backs the new "System Prompt Templates" admin section.

CREATE TABLE IF NOT EXISTS "system_prompt_domains" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "system_prompt_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "template_type" text NOT NULL,
  "domain_id" integer,
  "version" integer NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "extracted_text" text NOT NULL,
  "uploaded_by" text NOT NULL,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_active" boolean DEFAULT false NOT NULL
);

-- Seed the Foundation layer from the current active legacy master template so
-- the existing "master" prompt surfaces as Foundation v1 (a COPY — the legacy
-- table and live generation are left completely intact). Only seeds when no
-- Foundation row exists yet, so this is safe to re-run.
INSERT INTO "system_prompt_templates"
  ("template_type", "domain_id", "version", "filename", "mime_type", "extracted_text", "uploaded_by", "is_active")
SELECT 'foundation', NULL, 1, pt."filename", pt."mime_type", pt."extracted_text", pt."uploaded_by", true
FROM "prompt_templates" pt
WHERE pt."is_active" = true
  AND NOT EXISTS (
    SELECT 1 FROM "system_prompt_templates" spt WHERE spt."template_type" = 'foundation'
  )
LIMIT 1;
