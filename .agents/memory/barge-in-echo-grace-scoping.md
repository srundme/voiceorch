---
name: Barge-in echo-grace scoping
description: The echo-grace suppression window must cover only sentence-start + playback-tail, never the whole sentence, or barge-in dies.
---

# Barge-in echo-grace scoping

**Rule:** The echo-grace window that suppresses non-semantic barge-in (pipeline
`bargeInHoldUntil`, webcall `echoGraceUntil`) must be armed at exactly two moments:
(1) once at each sentence/utterance START, and (2) at playback END (tail grace).
It must NOT be re-armed per audio chunk/frame, nor set to span the full sentence
duration (`now + sentenceDurationMs + echoGraceMs`).

**Why:** Both barge-in detectors (energy/RMS and streaming-STT) are gated on
`now < grace`. Because audio chunks ship every ~20-40 ms, any per-chunk re-arm
(`grace = now + echoGraceMs`) keeps the window permanently active for the whole
sentence, so the caller can never interrupt a long reply — the agent talks over
them. Short sentences hid the bug because they ended before grace mattered. The
grace exists only to ignore the agent's OWN opening echo (sidetone / browser AEC
settle) and the closing word's returning echo at end-of-playback.

**How to apply:** Mid-sentence self-echo is NOT suppressed by the grace — it is
rejected by the elevated barge-in energy threshold (4× normal VAD) + min-frames,
and by the streaming-STT word-count gate. Trust those discriminators instead of
widening the grace. Keep telephony (`pipeline.ts` playSentence drain + buffered
loops) and web (`webcall.ts` process() streaming + buffered loops) in lockstep —
a fix in one path without the other leaves phone or web un-interruptible. Tail
protection stays via `armTailEchoGrace()` (telephony) and the tail-silence-drain
grace extension `now + AUDIO_TAIL_SILENCE_MS + WEB_TAIL_ECHO_MARGIN_MS` (web).

## The streaming-STT INPUT gate is a separate trap from the detector grace
**Rule:** The gate that decides whether to even FORWARD caller audio frames to the
streaming STT during agent speech must use the same narrow per-sentence window
(`now < bargeInSentenceStartAt + bargeInEchoGraceMs || now < greetingEchoHoldUntil`),
NOT `isPlaying || now < bargeInHoldUntil`.

**Why:** `bargeInHoldUntil` is extended whole-sentence in `_playSentenceImpl`, and
`isPlaying` is true for the entire reply. Gating the STT INPUT feed on either one
starves Sarvam of caller audio for the whole utterance, so only a shout loud enough
to trip the energy detector could interrupt — normal-volume barge-in silently died
(regression). Residual carrier echo that slips through after the grace is still
rejected downstream at the TRANSCRIPT level by the content-match `isSelfEcho()` +
the post-playback tail-echo time guard, so narrowing the input gate is safe.

**How to apply:** Keep the input gate and the detector grace on the SAME window.
Never reintroduce `isPlaying`/`bargeInHoldUntil` into the input-forwarding path.
The call-772 greeting-restart protection is preserved because `greetingEchoHoldUntil`
still gates the full greeting and mid-greeting echo is caught by `isSelfEcho()`.
