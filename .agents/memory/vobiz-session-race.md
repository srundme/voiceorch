---
name: VoBiz session race condition and silence fix
description: VoBiz drops calls after ~2s if no audio arrives; fix is silence frames during createSession init
---

## The race condition

VoBiz drops the call ~2 seconds after the WebSocket "start" event if the audio bridge receives no audio. This happens even with `keepCallAlive="true"` on the `<Stream>` element. Our `createSession` makes multiple sequential DB round-trips (agent fetch → user concurrency check → provider keys → platform settings → call record), which can take 2-5 s when pg-pool is busy or connections are cold (`connectionTimeoutMillis: 5_000` ms in lib/db/src/index.ts).

The `sessionEndedBeforeReady` flag in `vobiz.ts` already existed to detect this race; it was not a preventive fix.

## The fix

In `handleVobizWebSocket`, on the "start" event: start a 20ms `setInterval` that sends PCM-zero silence frames (160 samples × 2 bytes = 320-byte frames) via `sendAudioToVobiz`. This keeps the VoBiz audio bridge alive while `createSession` completes. The `stopSilence()` callback cancels the interval on:
- First real pipeline audio (via `onAudioOut`)
- Session ready (safety-net)
- `onCallEnd`
- `createSession` error

**Why:** VoBiz's audio bridge has a ~2s no-audio timeout. DB pool latency under load can exceed this. Sending silence frames is standard telephony practice (hold music / comfort noise during call setup).

**How to apply:** Any other telephony provider that has a similar "no audio received" timeout should get the same treatment.

## fetch_deployment_logs diagnostic note

`fetch_deployment_logs` returns logs from the **Replit dev server** (`hostname="nixos"`), NOT Railway production. VoBiz traffic in production goes to `app.snapserve.ai` → `server: railway-hikari` (Railway). Railway production logs are NOT accessible via this tool. When debugging VoBiz issues, zero VoBiz logs in `fetch_deployment_logs` does NOT mean VoBiz isn't hitting the server — it means you're looking at the wrong server's logs.
