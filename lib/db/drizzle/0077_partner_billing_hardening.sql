-- Partner billing hardening (post-review).
-- 1) Idempotency backstop: at most ONE partner_earning ledger row per call,
--    enforced in the DB so racing end-of-call paths can never double-credit
--    a partner even if application-level claims are bypassed.
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_tx_partner_earning_call_uniq"
ON "wallet_transactions" ("call_id")
WHERE "type" = 'partner_earning' AND "call_id" IS NOT NULL;
--> statement-breakpoint
-- 2) Rate invariants (also validated at every write site in app code).
ALTER TABLE "partners" ADD CONSTRAINT "partners_base_rate_nonneg_check"
CHECK ("base_rate_cents_per_min" >= 0);
--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_default_gte_base_check"
CHECK ("default_client_rate_cents_per_min" >= "base_rate_cents_per_min");
