-- White-label partner transactional mail: send From the partner's domain, not SnapServe.
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "mail_from_name" text;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "mail_from_email" text;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "mail_domain_status" text DEFAULT 'none' NOT NULL;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "mail_dns_records" jsonb;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "mail_domain_verified_at" timestamptz;
