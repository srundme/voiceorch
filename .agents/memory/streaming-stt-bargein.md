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

**Anti-echo floor:** no-AEC carriers echo the agent's own TTS back with real
energy, so a very low configured Energy Threshold (users set ~200) will
false-trigger. During `isSendingTtsAudio` on non-webcall providers the streaming
path raises the bar to `max(configured, ~1200)`. Apply this floor ONLY where
there is no full-sentence hold (i.e. the streaming path), or you silently
desensitise batch too. `isSendingTtsAudio` also spans the TTS first-byte/synthesis
wait (no echo yet), so if soft-spoken callers still can't interrupt, narrow the
floor to actual outbound-audio windows or lower it toward ~900 — never back to
200 on a no-AEC carrier.

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
