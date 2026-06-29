---
name: VoBiz transfer UUID mismatch
description: VoBiz's only valid Transfer id is the live CallUUID from the answer webhook; the dial response returns a request_uuid that 404s. A corr token reconciles the one call record in place.
---

## The durable rule

`/Call/{uuid}/Transfer/` (and other VoBiz REST mutations) accept ONLY the live `call_uuid`, delivered as `CallUUID` on the **answer webhook** (mirrored to the WS as `urlCallUuid`). The dial API returns a **`request_uuid`** — an id for that dial request, NOT the call — which 404s on Transfer. There is no dial-time call_uuid; do not try to capture/store one. `msg.start.callId` is a stream-session id, last-resort fallback only.

**Why:** these two ids come from different VoBiz subsystems and never equal each other, so any reconcile keyed on `providerCallId === CallUUID` silently fails for VoBiz outbound.

## The duplicate-record trap

Only direct outbound pre-creates a call row at dial time (campaigns/inbound insert fresh in `createSession`). That row can't hold the live CallUUID yet, so reconciliation must key on something that exists at BOTH dial time and answer time: an opaque **`corr` token** minted at dial and threaded dial → answer_url → every `/vobiz/voice` response branch (default AND queue/IVR/voicemail redirects) → WS URL → `createSession`. `createSession` matches `metadata.corrToken` first (VoBiz), falls back to `providerCallId === externalCallId` (Twilio/Plivo), merges prior metadata, and writes the live CallUUID over both `providerCallId` and `externalCallId`.

**How to apply:** any VoBiz outbound entry point that pre-creates a call row MUST mint a corr token, append `&corr=` to its answer_url, and store it in row metadata — AND every branch that emits the answer XML (including the common default response, not just queue/IVR) must forward `corr`, or you get a duplicate in_progress row + a 404ing transfer. The default `/vobiz/voice` branch is the easy one to forget.
