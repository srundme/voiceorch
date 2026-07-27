---
name: Call-billing atomic claim
description: Why call billing (debit + partner spread) must claim via conditional UPDATE, not a pre-read costCents check
---

**Rule:** Any end-of-call billing work (wallet debit, partner spread credit) must be gated by an atomic claim: `UPDATE calls SET cost_cents = $x WHERE id = $id AND (cost_cents IS NULL OR cost_cents <= 0) RETURNING id` — only the path that wins the claim performs money movement. Never gate on a pre-read `costCents` check alone.

**Why:** Two end paths can race on the same call — the HTTP `PATCH /calls/:id/end` route and the WS-close `endSession` path. Both used to pre-read `costCents` then bill; concurrent execution passed both checks and double-debited the client AND double-credited the partner spread. Flagged critical in the partner-panel review.

**How to apply:**
- Both sites now claim atomically; keep any new billing site (or refactor) on the same pattern.
- Partner spread has a second DB-level backstop: partial unique index `wallet_tx_partner_earning_call_uniq` (one `partner_earning` wallet-transaction row per call, migration 0077, mirrored in the drizzle schema). `creditPartnerSpreadOnCall` inserts the ledger row FIRST inside a transaction — a 23505 conflict aborts before the wallet increment, so balance and ledger can never diverge. Treat 23505 there as "already credited", return 0.
- If a new per-call money-movement type is added, give it the same partial-unique-per-call backstop.
