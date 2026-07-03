---
name: Webhook payment verification pattern
description: Server-to-server payment webhooks must not trust body-supplied identifiers when the signing secret is unconfigured or optional
---

Any payment-provider webhook (Razorpay, Stripe, etc.) that only checks a signature "if the secret happens to be configured" is fail-open: with the secret unset, the endpoint credits money based purely on attacker-supplied JSON (event type, order_id, payment_id).

**Why:** Proven exploitable in VoiceOrch's `/api/wallet/webhook` — an authenticated user could create a real pending topup order, then POST a forged `payment.captured` event with a fake payment_id to the (unauthenticated-by-design) webhook route and get credited without paying, because `RAZORPAY_WEBHOOK_SECRET` was never configured.

**How to apply:** For any such webhook, don't rely solely on the optional HMAC signature. For the branch that actually moves money/credits a balance, always make a live server-side API call back to the provider (payments.fetch / equivalent) using your own server-held secret key, and require the provider's own response to confirm status=captured AND that the returned order_id/amount matches what the webhook body claimed. A forged request cannot fabricate what the provider's live API returns for a real payment ID. Keep the signature check too as defense-in-depth, but never make it the only gate.
