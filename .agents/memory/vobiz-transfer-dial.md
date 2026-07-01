---
name: VoBiz call transfer (transfer_to_human) drops the caller
description: Why VoBiz cold/warm transfers disconnect instead of bridging to a human, and the two invariants that fix it
---

# VoBiz transfer drops the caller ("unavailable") instead of bridging

Two independent root causes, both must be fixed, and they recur on BOTH VoBiz
transfer paths: the LLM `transfer_to_human` tool (`onCallTransfer` in
`session.ts`) AND the manual dashboard `POST /calls/:id/transfer`
(`triggerTransfer` in `session.ts`, called from `routes/calls.ts`).

## 1. `<Dial>` MUST carry a `callerId`
VoBiz (Plivo-compatible) rejects the outbound bridge to the human agent unless
`<Dial callerId="…">` is set, and the callerId must be a **VoBiz-provisioned
number on the account** — NOT the customer's number. Without it the dial fails
and the caller is dropped. The transfer-xml builders take an optional `callerId`.
- Tool path: callerId = `callDirection==="outbound" ? params.fromNumber : params.toNumber`
  (the platform number; for outbound `fromNumber` is the shared platform number,
  for inbound `toNumber` is). Threaded as `&callerId=` into the transfer-xml URL,
  read back in the `/webhooks/vobiz/transfer-xml` route.
- Manual path: callerId = the VoBiz provider's configured `extraConfig.fromNumber`
  (that IS the provisioned number regardless of direction).
- `xmlEscape` must escape `"`/`'` too now that a query-derived value lands in an
  XML attribute.

## 2. `wasTransferred` WS-close race
**Why:** VoBiz sends the media-stream `stop` event / closes the WS *during* the
transfer REST `await`. `vobiz.ts` `onCallEnd` guards `ws.close()` on
`getSession(sessionId)?.wasTransferred`, which reads the **in-memory closure
flag synchronously** (a getter) — it does NOT read Redis session meta. If the
flag is still false when `stop` arrives, we send a close frame VoBiz treats as a
hang-up and the in-flight transfer aborts (tell-tale: the "skipping ws.close()"
log never appears even though the transfer API returned 202).

**How to apply:** set `wasTransferred = true` (+ `transferredTo` + `patchSessionMeta`)
**BEFORE** dispatching the provider transfer call, and reset to false in the
catch on failure so a genuinely failed transfer still ends the call instead of
hanging with a dead AI stream. `triggerTransfer` runs outside `createSession`'s
closure, so the session object exposes a `setTransferred(to)` method to flip the
in-memory flag from outside.

**Cross-provider invariant:** the `onCallEnd` guard is NOT vobiz-only. EVERY
telephony transport's `onCallEnd` must `skip ws.close()` when
`getSession(sessionId)?.wasTransferred` — `twilio.ts` and `plivo.ts` share the
exact same media-stream stop/close race, so a bare `onCallEnd: () => ws.close()`
there silently aborts provider transfers. Any NEW transport adapter must mirror
this or its transfers will drop the caller.

## Other VoBiz transfer facts (confirmed)
- Transfer endpoint is `POST /Call/{uuid}/` (NO `/Transfer/` suffix) with
  `X-Auth-ID`/`X-Auth-Token` headers (not Basic auth) → 202 on success.
- The stored CallUUID is always the **A-leg**; always use `legs:"aleg"` +
  `aleg_url` + `aleg_method:"GET"`. `bleg`/`bleg_url` → 404 "call not found".
- VoBiz `<Dial>` requires `<Number>` inside it (Plivo syntax); bare
  `<Dial>NUMBER</Dial>` (Twilio syntax) makes VoBiz drop the call.
