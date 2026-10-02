-- SnapServe Sales Pipeline (internal founder/teammate CRM). Self-contained:
-- no foreign keys to non-sales tables, so this file applies standalone.

CREATE TABLE IF NOT EXISTS "sales_users" (
  "id" serial PRIMARY KEY,
  "email" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "role" text NOT NULL,
  "password_hash" text,
  "status" text NOT NULL DEFAULT 'active',
  "failed_logins" integer NOT NULL DEFAULT 0,
  "locked_until" timestamptz,
  "last_login_at" timestamptz,
  "deactivated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_users_email_uq" ON "sales_users" ("email");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_invites" (
  "id" serial PRIMARY KEY,
  "email" text NOT NULL,
  "role" text NOT NULL,
  "token_hash" text NOT NULL,
  "invited_by" integer,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_invites_token_hash_uq" ON "sales_invites" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_invites_email_idx" ON "sales_invites" ("email");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_sessions" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "sales_users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "ip" text,
  "user_agent" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_sessions_token_hash_uq" ON "sales_sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_sessions_user_idx" ON "sales_sessions" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_settings" (
  "id" integer PRIMARY KEY,
  "config" jsonb NOT NULL,
  "updated_by" integer,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_targets" (
  "id" serial PRIMARY KEY,
  "date" date NOT NULL,
  "kind" text NOT NULL,
  "day_type" text NOT NULL DEFAULT 'selling',
  "visits" integer NOT NULL DEFAULT 0,
  "conversations" integer NOT NULL DEFAULT 0,
  "demos" integer NOT NULL DEFAULT 0,
  "pilots" integer NOT NULL DEFAULT 0,
  "operating_paid" integer NOT NULL DEFAULT 0,
  "stretch_paid" integer NOT NULL DEFAULT 0,
  "note" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_targets_date_kind_uq" ON "sales_targets" ("date", "kind");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_audit" (
  "id" serial PRIMARY KEY,
  "actor_user_id" integer,
  "entity" text NOT NULL,
  "entity_id" text,
  "action" text NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_audit_entity_idx" ON "sales_audit" ("entity", "entity_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_webhook_events" (
  "id" serial PRIMARY KEY,
  "event_id" text NOT NULL,
  "source" text NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "payload" jsonb,
  "status" text NOT NULL DEFAULT 'received',
  "company_id" integer,
  "error" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_webhook_events_event_id_uq" ON "sales_webhook_events" ("event_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_imports" (
  "id" serial PRIMARY KEY,
  "kind" text NOT NULL,
  "filename" text,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "summary" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_companies" (
  "id" serial PRIMARY KEY,
  "is_demo" boolean NOT NULL DEFAULT false,
  "name" text NOT NULL,
  "name_normalized" text NOT NULL,
  "domain_normalized" text,
  "website" text,
  "sector" text,
  "city" text,
  "area" text,
  "address" text,
  "map_link" text,
  "owner_id" integer,
  "source" text,
  "source_campaign" text,
  "original_source" text,
  "original_source_campaign" text,
  "original_enquiry_at" timestamptz,
  "contact_permission_evidence" text,
  "priority" text NOT NULL DEFAULT 'medium',
  "calling_volume" integer,
  "current_calling_team" text,
  "pain_point" text,
  "budget_fit" text NOT NULL DEFAULT 'unknown',
  "decision_maker" text,
  "last_activity_at" timestamptz,
  "next_action" text,
  "next_action_due_at" timestamptz,
  "first_paid_at" timestamptz,
  "duplicate_of_company_id" integer,
  "needs_dedupe_review" boolean NOT NULL DEFAULT false,
  "internal_notes" text,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_companies_domain_uq" ON "sales_companies" ("domain_normalized") WHERE "domain_normalized" IS NOT NULL AND "is_demo" = false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_companies_name_norm_idx" ON "sales_companies" ("name_normalized");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_companies_owner_idx" ON "sales_companies" ("owner_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_contacts" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "sales_companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL DEFAULT '',
  "role" text,
  "phone" text,
  "phone_normalized" text,
  "email" text,
  "email_normalized" text,
  "preferred_channel" text,
  "is_decision_maker" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_contacts_company_idx" ON "sales_contacts" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_contacts_phone_idx" ON "sales_contacts" ("phone_normalized");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_contacts_email_idx" ON "sales_contacts" ("email_normalized");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_opportunities" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "sales_companies"("id") ON DELETE CASCADE,
  "stage" text NOT NULL DEFAULT 'Identified',
  "stage_changed_at" timestamptz NOT NULL DEFAULT now(),
  "owner_id" integer,
  "qualification" jsonb,
  "demo_buyer_contact_id" integer,
  "demo_at" timestamptz,
  "pilot_readiness" jsonb,
  "review" jsonb,
  "terms" jsonb,
  "later_reason" text,
  "later_action_at" timestamptz,
  "lost_reason" text,
  "bypass_reason" text,
  "bypass_by" integer,
  "is_demo" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "closed_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_opportunities_open_uq" ON "sales_opportunities" ("company_id") WHERE "stage" NOT IN ('Lost', 'Live');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_opportunities_stage_idx" ON "sales_opportunities" ("stage");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_stage_history" (
  "id" serial PRIMARY KEY,
  "opportunity_id" integer NOT NULL REFERENCES "sales_opportunities"("id") ON DELETE CASCADE,
  "from_stage" text,
  "to_stage" text NOT NULL,
  "changed_by" integer,
  "changed_at" timestamptz NOT NULL DEFAULT now(),
  "evidence" jsonb,
  "bypass" boolean NOT NULL DEFAULT false,
  "note" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_stage_history_opp_idx" ON "sales_stage_history" ("opportunity_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_activities" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "sales_companies"("id") ON DELETE CASCADE,
  "opportunity_id" integer,
  "contact_id" integer,
  "owner_id" integer,
  "type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'completed',
  "occurred_at" timestamptz,
  "scheduled_at" timestamptz,
  "flag_visit" boolean NOT NULL DEFAULT false,
  "flag_first_visit" boolean NOT NULL DEFAULT false,
  "flag_buyer_conversation" boolean NOT NULL DEFAULT false,
  "flag_demo" boolean NOT NULL DEFAULT false,
  "flag_pilot_started" boolean NOT NULL DEFAULT false,
  "outcome" text,
  "notes" text,
  "next_action" text,
  "next_action_due_at" timestamptz,
  "is_demo" boolean NOT NULL DEFAULT false,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_activities_company_idx" ON "sales_activities" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_activities_occurred_idx" ON "sales_activities" ("occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_activities_scheduled_idx" ON "sales_activities" ("scheduled_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_tasks" (
  "id" serial PRIMARY KEY,
  "company_id" integer REFERENCES "sales_companies"("id") ON DELETE CASCADE,
  "opportunity_id" integer,
  "pilot_id" integer,
  "subscription_id" integer,
  "owner_id" integer,
  "title" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'follow_up',
  "due_at" timestamptz,
  "status" text NOT NULL DEFAULT 'open',
  "outcome" text,
  "completed_at" timestamptz,
  "completed_by" integer,
  "dedupe_key" text,
  "is_demo" boolean NOT NULL DEFAULT false,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_tasks_dedupe_key_uq" ON "sales_tasks" ("dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_tasks_owner_status_idx" ON "sales_tasks" ("owner_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_tasks_company_idx" ON "sales_tasks" ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_pilots" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "sales_companies"("id") ON DELETE CASCADE,
  "opportunity_id" integer,
  "status" text NOT NULL DEFAULT 'Draft',
  "use_case" text,
  "language" text,
  "qualification_criteria" text,
  "approved_script" text,
  "lead_count" integer,
  "contact_basis_confirmed" boolean NOT NULL DEFAULT false,
  "campaign_ref" text,
  "report_link" text,
  "recording_links" jsonb,
  "onboarding_started_at" timestamptz,
  "campaign_started_at" timestamptz,
  "window_start" timestamptz,
  "window_end" timestamptz,
  "review_at" timestamptz,
  "owner_id" integer,
  "followup_owner_id" integer,
  "attempt_allowance" integer NOT NULL DEFAULT 200,
  "extension_attempts" integer,
  "extension_reason" text,
  "extension_cost_limit_paise" integer,
  "extension_review_at" timestamptz,
  "extension_approved_by" integer,
  "capacity_override_reason" text,
  "capacity_override_by" integer,
  "readiness" jsonb,
  "quality_review" jsonb,
  "buyer_feedback" text,
  "accepted_outcomes_note" text,
  "proposed_next_step" text,
  "customer_report_notes" text,
  "internal_notes" text,
  "cancelled_reason" text,
  "is_demo" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_pilots_company_idx" ON "sales_pilots" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_pilots_status_idx" ON "sales_pilots" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_pilot_snapshots" (
  "id" serial PRIMARY KEY,
  "pilot_id" integer NOT NULL REFERENCES "sales_pilots"("id") ON DELETE CASCADE,
  "snapshot_key" text NOT NULL,
  "as_of" timestamptz NOT NULL,
  "source" text NOT NULL DEFAULT 'manual',
  "attempts" integer NOT NULL DEFAULT 0,
  "distinct_records" integer NOT NULL DEFAULT 0,
  "answered" integer NOT NULL DEFAULT 0,
  "meaningful" integer NOT NULL DEFAULT 0,
  "qualified_people" integer NOT NULL DEFAULT 0,
  "accepted_outcomes" integer NOT NULL DEFAULT 0,
  "callback_requests" integer NOT NULL DEFAULT 0,
  "confirmed_appointments" integer NOT NULL DEFAULT 0,
  "connected_minutes" integer NOT NULL DEFAULT 0,
  "cost_paise" integer NOT NULL DEFAULT 0,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_pilot_snapshots_key_uq" ON "sales_pilot_snapshots" ("pilot_id", "snapshot_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_proposals" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "sales_companies"("id") ON DELETE CASCADE,
  "opportunity_id" integer,
  "monthly_fee_paise" integer NOT NULL,
  "setup_fee_paise" integer NOT NULL DEFAULT 0,
  "included_minutes" integer NOT NULL DEFAULT 0,
  "scope" text,
  "gst_rate_bps" integer NOT NULL DEFAULT 1800,
  "status" text NOT NULL DEFAULT 'draft',
  "terms_accepted_at" timestamptz,
  "terms_accepted_by" text,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_proposals_company_idx" ON "sales_proposals" ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_subscriptions" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "sales_companies"("id") ON DELETE CASCADE,
  "proposal_id" integer,
  "monthly_fee_paise" integer NOT NULL,
  "included_minutes" integer NOT NULL DEFAULT 0,
  "customer_owner_id" integer,
  "status" text NOT NULL DEFAULT 'active',
  "start_date" date,
  "live_at" timestamptz,
  "renewal_date" date,
  "onboarding_checks" jsonb,
  "paused_at" timestamptz,
  "cancelled_at" timestamptz,
  "cancel_reason" text,
  "is_demo" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_subscriptions_company_idx" ON "sales_subscriptions" ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_payments" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "sales_companies"("id") ON DELETE CASCADE,
  "proposal_id" integer,
  "subscription_id" integer,
  "kind" text NOT NULL,
  "fee_paise" integer NOT NULL,
  "tax_paise" integer NOT NULL DEFAULT 0,
  "reference" text,
  "received_at" timestamptz NOT NULL,
  "status" text NOT NULL DEFAULT 'recorded',
  "verified_at" timestamptz,
  "verified_by" integer,
  "refunded_paise" integer NOT NULL DEFAULT 0,
  "notes" text,
  "is_demo" boolean NOT NULL DEFAULT false,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_payments_company_idx" ON "sales_payments" ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_payment_adjustments" (
  "id" serial PRIMARY KEY,
  "payment_id" integer NOT NULL REFERENCES "sales_payments"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "fee_delta_paise" integer NOT NULL DEFAULT 0,
  "tax_delta_paise" integer NOT NULL DEFAULT 0,
  "reason" text NOT NULL,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_payment_adjustments_payment_idx" ON "sales_payment_adjustments" ("payment_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_expenses" (
  "id" serial PRIMARY KEY,
  "date" date NOT NULL,
  "category" text NOT NULL,
  "is_acquisition" boolean NOT NULL DEFAULT false,
  "source" text,
  "source_campaign" text,
  "amount_paise" integer NOT NULL,
  "description" text,
  "is_demo" boolean NOT NULL DEFAULT false,
  "created_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "sales_targets" ("date", "kind", "day_type", "visits", "conversations", "demos", "pilots")
SELECT
  d::date,
  'daily',
  CASE WHEN EXTRACT(ISODOW FROM d) = 7 THEN 'review' ELSE 'selling' END,
  CASE WHEN EXTRACT(ISODOW FROM d) = 7 THEN 0 ELSE 16 END,
  CASE WHEN EXTRACT(ISODOW FROM d) = 7 THEN 0 ELSE 6 END,
  CASE WHEN EXTRACT(ISODOW FROM d) = 7 THEN 0 ELSE 3 END,
  CASE WHEN EXTRACT(ISODOW FROM d) = 7 THEN 0 ELSE 2 END
FROM generate_series('2026-10-03'::date, '2026-11-01'::date, interval '1 day') AS d
ON CONFLICT ("date", "kind") DO NOTHING;
--> statement-breakpoint
INSERT INTO "sales_targets" ("date", "kind", "day_type", "operating_paid", "stretch_paid") VALUES
  ('2026-10-09', 'cumulative_paid', 'selling', 2, 5),
  ('2026-10-16', 'cumulative_paid', 'selling', 6, 15),
  ('2026-10-23', 'cumulative_paid', 'selling', 12, 30),
  ('2026-11-01', 'cumulative_paid', 'review', 20, 50)
ON CONFLICT ("date", "kind") DO NOTHING;
