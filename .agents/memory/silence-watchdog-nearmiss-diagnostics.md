---
name: Silence watchdog near-miss diagnostics
description: How SilenceWatchdog stays alive during genuine caller speech, and how to diagnose a suspected false silence-timeout hangup from logs.
---

`SilenceWatchdog` (endpointing.ts) is already kept alive by BOTH signals, on both
telephony and webcall paths (they share the same pipeline core):
- Accepted streaming-STT partials (`this.resetHangupTimer()` is called on every
  non-empty interim while not playing) — a full reset, same as a real final.
- Raw caller speech energy (`onSpeechEnergy()`), fed whenever VAD/noise-gate
  reports `hasSpeech` and the agent isn't currently speaking.

**Why a hangup can still look false:** the watchdog's `onExpired()` re-arms
silently (no log) whenever it finds recent activity instead of firing. That
silent re-arm made a *genuine* false hangup elsewhere impossible to
distinguish from normal behavior in logs. Fixed by adding `onNearMiss` to
`SilenceWatchdogOptions` — fires with `{cause: "busy"|"recent_speech_energy",
msSinceLastSpeech, rearmedForMs}` on every silent re-arm, logged in pipeline.ts
as "Silence watchdog near-miss".

**How to apply:** when a user reports a call cut off while they were "clearly
talking", grep the call's logs for "Silence watchdog near-miss" entries in the
minutes before the drop — their absence narrows the search to the noise-gate/
VAD layer (audio.ts `NoiseCanceller`, already attenuates rather than zeroes
sub-threshold frames) rather than the watchdog logic itself.
