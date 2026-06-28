---
name: Caller-memory key must be direction-aware
description: Why caller-memory keying needs call direction, not humanPhone(from,to), and every entry point that must carry it
---

# Caller-memory key is direction-aware

Caller memory (`caller_profiles`/`caller_facts`/`caller_call_archive`) is keyed on
`(agent_id, phone_number)`. The phone_number must be the OTHER party:
- **inbound** → the caller (`from`)
- **outbound** → the dialed party (`to`)

Use `resolveCallerKey(direction, from, to)` (`@workspace/db`), NOT the deprecated
`humanPhone(from, to)`. `humanPhone` returns `from` whenever it's "real" — but on
outbound the `from` is the shared platform number, so every outbound callee
collapses onto ONE key and the agent leaks one caller's memory into another's
greeting. Placeholder sentinels `+10000000000`/`+10000000001` (canonical
`10000000000`/`10000000001`) are rejected to `null` by `canonicalizeCallerKey` so
they can't become a shared key either.

**Why:** the original bug — all outbound callers shared one profile because the key
was direction-blind.

## How to apply — direction must be plumbed end to end
Every OUTBOUND telephony entry point must mark the call so the WS handler keys off
`to`:
- Dial sites append `&dir=out` to the answer/webhook URL: `calls.ts`,
  `campaignCaller.ts`, `callbackScheduler.ts`, `routes/meta.ts` (twilio/plivo/vobiz).
- `index.ts` WS upgrade parses `dir=out` → `callDirection` → `createSession`.
- `webhooks.ts` voice handlers read `req.query.dir` and pass `callDirection` into
  the XML generators (`getVobizAnswerXML` etc.).
- **Easy to miss:** VoBiz queue-hold and IVR are the only providers with
  intermediate `<Redirect>`/`<GetDigits>` re-entries. Those redirect URLs AND the
  `/webhooks/vobiz/ivr` digit-callback must re-carry `dir`/`pt`/`campaignLeadId`,
  or an outbound call routed through queue/IVR reverts to the inbound default and
  re-collapses memory. Twilio/Plivo have no queue/IVR redirects.

`session.ts` persists `direction` + resolved `callerKey` into call metadata, and
`GET /calls/:id/caller-memory` prefers that persisted key (legacy rows fall back to
direction-aware, then direction-blind `humanPhone`).

Historical rows written before this fix are NOT migrated — they remain keyed under
the shared/placeholder number until a backfill script re-keys them.
