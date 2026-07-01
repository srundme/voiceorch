---
name: Call duration + recording anchored to carrier answer time
description: Why VoBiz call duration/recording clock must anchor to the answer-webhook instant, not session-object creation, and the guardrails around the threaded value.
---

# Anchor the call timeline to the carrier answer instant, not session creation

On VoBiz, several seconds elapse between the carrier answering and the media
WebSocket opening: answer webhook → return Answer XML → VoBiz opens media WS →
`start` event → `createSession`. Anchoring `session.startedAt` (duration clock)
and the `RecordingBuffer` timeline to `new Date()` at session creation therefore
**under-reports duration** and makes the **recording start too early** relative to
what the caller heard live (greeting lands at t=0 instead of a few seconds in).

**Rule:** capture `Date.now()` at the answer webhook (`/webhooks/vobiz/voice` and
`/webhooks/vobiz/ivr`), thread it as `?ans=<epochMs>` on the media-WS URL (via
`getVobizAnswerXML`), and feed it through `handleVobizWebSocket` →
`createSession(answeredAt)`. `session.startedAt = answeredAt ?? now`;
`RecordingBuffer.anchorStart(answeredAt)` sets the shared `startMs` so the
answer→first-media gap is padded as leading silence.

**IVR path anchors at the digit-press instant, not the pre-menu answer** — the AI
greeting starts after the digit, so anchoring earlier would count menu time as
agent dead air.

**Webcall has NO carrier answer gap** (browser connects directly) — it does not
set `answeredAt`, so it falls back to session-creation time unchanged. Do not try
to add an answer anchor to the webcall path.

**Why the guardrails (added after code review):** `?ans` is an attacker-
controllable query param on the WS upgrade URL. Without validation it can:
- make `durationSeconds` negative (future timestamp),
- drive an unbounded `Buffer.alloc` in `RecordingBuffer.append` padding
  (`now - startMs` huge → memory-exhaustion DoS).

**How to apply:** validate `ans` at WS ingress (`index.ts`) to a sane window
(`now-120s .. now+5s`, finite, >0) else drop to `undefined`; cap per-append
recorder silence at `MAX_PAD_MS` (5 min); clamp `durationSeconds` with
`Math.max(0, …)`. Any future carrier that has an answer→media gap should reuse
this same threading + validation pattern.
