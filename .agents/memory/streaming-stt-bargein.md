---
name: Streaming-STT telephony barge-in
description: Why energy-based barge-in must run on the streaming-STT path, not only the batch path
---

# Streaming-STT telephony barge-in

Energy/frame barge-in must be evaluated on BOTH the batch-STT and streaming-STT
audio paths. `handleProcessedAudio()` has an early `if (this.streamSTT) { …sendAudio(); return; }`
branch — if the energy detector lives only after that branch, streaming STT
(Sarvam/VoBiz saarika/saaras) can interrupt the agent ONLY via a transcript
(semantic-interim keyword or a FINAL-transcript word-count).

**Why this bites:** on telephony, streaming STT endpoints on silence and rarely
emits a FINAL while the caller is talking OVER the agent, so ordinary
interruptions ("actually…", "I have a question") never fire even though playback
abort on `bargeInRequested` works perfectly. The user sees "barge-in settings ON
but interruption does nothing."

**The fix shape:** a shared energy detector called on both paths.
- Batch path passes `respectHoldUntil=true` — it relies on the extended
  full-sentence `bargeInHoldUntil` to suppress the agent's own echo, so it keeps
  the configured Energy Threshold unchanged.
- Streaming path passes `respectHoldUntil=false` — the full-sentence hold would
  otherwise re-suppress it; it relies only on the per-sentence echo grace
  (`bargeInSentenceStartAt + bargeInEchoGraceMs`) and `greetingEchoHoldUntil`,
  matching the streaming transcript barge-in.

**Anti-echo bar — a FIXED number is unsolvable; self-calibrate per call.** No-AEC
carriers echo the agent's own TTS back with real energy, so a low configured
Energy Threshold (users set ~200, below the ~300 VAD gate) self-triggers on the
echo. But a fixed floor (we tried `max(configured, 1200)`) is ALSO wrong: on a
normal-volume caller 1200 is too high and energy barge-in fires ~never (call 1356:
only one near-shout fired all call). The echo level is **line-specific**, so the
only robust fix is to MEASURE it per call:
- `playbackEchoFloor` = asymmetric EMA (rise slow ~0.05 / fall fast ~0.3) of the
  inbound frame RMS. Bar during active TTS =
  `max(configured, min(echoFloor × 1.6, MAX~2500))`.
- **Sample the floor ONLY in the first ~250 ms after each line starts** (inside the
  echo-grace early-return). Human reaction to talk over THIS line is >~300 ms, so
  those frames are near-certainly pure echo, not the caller. Sampling the whole
  grace window (or any below-bar frame) lets a caller who barges in early poison
  the floor against themselves — a normal caller is BELOW the bar (that's the bug),
  so below-bar frames must NEVER feed the floor.
- Trust the learned floor only after ~10 samples; before that use a conservative
  cold-start fallback (~1200) so echo can't self-trigger on frame 1.
- Adaptive applies ONLY while `isSendingTtsAudio` (that's the only time echo
  exists); between sentences honour the configured threshold. Clamp caps only the
  echo-derived boost at MAX — a user threshold above MAX is never lowered.
- Streaming path also caps min-frames (~8, ~160 ms) since energy is the ONLY
  real-time signal there.
All knobs env-tunable (`BARGE_IN_ADAPTIVE_ECHO_MARGIN`, `_MAX_THRESHOLD`,
`_ECHO_FLOOR_RISE/FALL_ALPHA`, `_ECHO_CALIBRATION_MS`, `_ECHO_FLOOR_MIN_SAMPLES`,
`_STREAMING_MIN_FRAMES`). Watch the throttled `energy barge-in monitor` log
(currentRms/echoFloor/effectiveThreshold) to tune from real calls.

## The other half: never gate the STT INPUT feed during agent speech

There are TWO ways streaming-STT telephony barge-in silently dies, and both must
stay fixed together:
1. Energy detector only on the batch path (this file's main lesson).
2. An **input-level self-echo gate** that drops caller frames before
   `streamSTT.sendAudio()` while the agent is talking. That was tried (to reject
   carrier echo with no AEC) and it starved Sarvam of caller audio for the whole
   reply, so ONLY a shout could interrupt — normal-volume barge-in was impossible.

**Rule:** never gate the STT input feed on `isPlaying` / `bargeInHoldUntil`
(whole-reply windows). Feed all caller frames to the recognizer unconditionally
and reject the agent's own echo on the TRANSCRIPT side instead (content-based
`isSelfEcho()` + post-playback tail-echo time guard in
`handleStreamingTranscript()`). The only acceptable input-side suppression is a
narrow window (per-sentence echo grace + greeting hold) — the same window the
energy detector uses — not the full reply.

**How to apply:** any change to interruption behaviour must be mirrored on both
STT paths; test on a live streaming-STT telephony call and check the
`streaming_energy` barge-in log (frames + effectiveMinFrames + effectiveThreshold).
