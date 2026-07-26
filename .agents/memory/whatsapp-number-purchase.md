---
name: WhatsApp number purchase flow
description: Invariants and unvalidated risks in the segmented WhatsApp onboarding (buy number via Razorpay / direct Meta connect)
---

# WhatsApp number purchase flow (segmented onboarding)

## Product invariants (decided Jul 2026)
- **No BYON anywhere** — users can never bring arbitrary external numbers into SnapServe WhatsApp.
- Non-business users (no WABA/Meta token) are served by the **shared platform channel only**; the segmentation question on the dashboard is "Do you have a Meta Business account?".
- **Every own channel requires WABA ID + permanent Meta token — even `buy_from_vobiz`.** Buying a number from SnapServe does not remove the Meta prerequisite; VoBiz auto-assigns the Phone Number ID after provisioning (channel stays `pending` until it appears).
- WhatsApp numbers and voice DIDs are **separate VoBiz inventories**. A voice DID can NOT be used for WhatsApp; WhatsApp numbers live in `phone_numbers` with `service='whatsapp'`, hidden from the voice list, blocked from agent assignment, billed by the same 30-day renewal engine.
- Meta access token is never stored (last4 only) — collected at confirm time from client memory; retry paths must re-ask for it.

## Payment-safety rules (architect-review hardened)
**Why:** payment captured + partial provisioning is the worst failure class; review found three real gaps.
- Initiate must serialize per-number via `pg_advisory_xact_lock` in the same transaction as the duplicate-check + order insert (read-then-insert alone lets two tabs double-order). A loser's stray Razorpay order expires unpaid — acceptable.
- After payment verified + carrier number ordered, ANY bookkeeping failure must refund + mark the order failed (never stuck `processing`), and log sub-account + carrier ids for manual reconciliation of the orphaned carrier number.
- `phone_numbers.number` is globally unique and released rows are kept → re-buying a previously released number must REUSE the released row (reset userId/agent/renewal fields), not insert.
- Carrier error bodies can echo request fields including the access token → `sanitizeCarrierError()` (exact-secret strip + long-token redact + cap) before persisting to `lastError` or returning to clients.

## Unvalidated risks (as of Jul 2026)
- VoBiz WhatsApp endpoints under `/messaging/…` (availability, number orders, channel create/list) have response shapes that are **defensively guessed, never live-tested** — dev env has no VOBIZ_* creds; parsing tries numbers/objects/items/data keys. If prod buy-flow fails mysteriously, verify real response shapes first.
- Correct channel-create base is `${VOBIZ_API_BASE}/messaging/channels/whatsapp` (a `/channels/whatsapp` path without `/messaging` was a real bug).
