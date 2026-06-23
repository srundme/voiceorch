---
name: Webcall start echo-grace must be re-armed per sentence
description: Why long multi-sentence webcall replies get clipped by false barge-in and the parity rule with pipeline.ts
---

# Webcall start echo-grace re-arm

**Rule:** In `webcall.ts` the START echo-grace window (suppressing non-semantic
barge-in while browser AEC re-adapts) must be tracked by a re-armable deadline
(`echoGraceUntil = Date.now() + BARGE_IN_ECHO_GRACE_MS`) that is reset at the
start of EVERY sentence's audio in the multi-sentence playback loop, plus at each
single-utterance playback start (greeting, clarification, final/goodbye). Both the
energy-based detector AND both streaming-STT branches (primary + fallback) must
gate on `Date.now() < echoGraceUntil`. Semantic interrupts ("stop") still bypass.

**Why:** It previously gated on `Date.now() - speakingStartedAt < GRACE`, and
`speakingStartedAt` is set ONCE at the start of the whole turn. For a long reply,
the 700 ms grace expired part-way through, so the agent's own speaker echo leaking
back through the mic (browser AEC has to re-adapt after each inter-sentence pause)
tripped the consecutive-loud-frame counter / produced a 1-word echo transcript and
set `interrupted = true`, clipping the response mid-sentence. pipeline.ts never had
this bug because it re-arms `bargeInHoldUntil` per `playSentence` call.

**How to apply:** This is the canonical drift between the two duplicate turn loops.
When touching barge-in / echo-grace in either file, keep the per-sentence re-arm in
parity: webcall = `echoGraceUntil`, pipeline = `bargeInHoldUntil` (re-armed in the
playTask loop + every direct playback branch, and `armTailEchoGrace()` at exit).
Note the web RMS barge-in threshold (800) is intentionally lower than telephony
(1200) because web audio is already AEC'd by the browser — do not raise it to match.

**CRITICAL boundary (do NOT cross):** the grace must be re-armed only at SENTENCE
START + at playback END (tail grace), never per audio chunk/frame nor for the full
sentence duration. Per-chunk re-arm (`bargeInHoldUntil = now + echoGraceMs` every
20ms chunk in pipeline drain/buffered loops) and full-duration re-arm
(`echoGraceUntil = now + sentenceDurationMs + echoGraceMs`, or per-40ms-frame in
webcall) keep the window permanently active for the whole sentence and suppress
BOTH detectors → long replies become un-interruptible. The short start grace is for
the opening words only; mid-sentence self-echo is rejected by the elevated energy
threshold (4× VAD) + min-frames and the streaming-STT word-count gate, NOT by
extending the grace. See [barge-in echo-grace scoping](barge-in-echo-grace-scoping.md).
