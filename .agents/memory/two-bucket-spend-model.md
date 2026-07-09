---
name: Two-bucket spend model (platform fee + provider cost)
description: How VoiceOrch's per-call spend is composed from two separate DB sources — use this when touching billing/usage aggregation UI or API.
---

Total spend for a call/user is the SUM of two independently-sourced, additive buckets — never derive one from the other:

- **Platform fee** — `wallet_transactions` rows with `type = 'call_debit'`, stored in **cents** (negative `amountCents`). This is the per-minute orchestration charge (managed $0.05/min or BYOP $0.035/min).
- **AI service / provider cost** — `usage_events` rows (per STT/LLM/TTS call), stored in **micros**. This is the underlying provider cost estimate.

**Unit conversion:** 1 cent = 10,000 micros. Convert wallet cents to micros (`× 10,000`) before combining with usage_events micros so all spend arithmetic happens in one unit (micros).

**Why:** these two tables track genuinely different cost components (platform markup vs. raw provider cost) — they are not duplicates and must both be summed, not chosen between. A page that only aggregates `usage_events` will show $0 spend for calls that had no measurable AI service cost logged but did carry a real platform-fee debit (or vice versa).

**How to apply:** any new spend aggregation (summary cards, exports, per-call breakdown) must join/sum both sources. Group `usage_events` by `callId` to get STT/LLM/TTS sub-totals per call; join to the matching `wallet_transactions` call_debit row (also by `callId` via its description/metadata) for the platform fee. `calls.userId` is a direct text column (Google sub) — no join through `users` needed for call-scoped queries, but `wallet_transactions.userId` is an integer FK to `users.id`, so that one join is still required.
