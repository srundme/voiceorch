---
name: Sarvam STT telephony hallucination guard
description: Speech-duration plausibility check added in the Sarvam adapter to drop noise-triggered hallucinated transcripts on telephony calls.
---

Telephony-only failure mode: line noise / comfort noise occasionally trips Sarvam's
own VAD into a spurious speech_start, and the acoustic model then hallucinates a
real-looking short transcript (e.g. "Out of") from a burst that was too short for a
human to have actually spoken it. Webcall audio is browser-AEC/noise-suppressed so
this practically never happens there — confirmed telephony-specific via call 1572.

The existing `checkTranscriptQuality` dangling-fragment heuristic (`transcriptQuality.ts`)
catches SOME of these by text shape, but not all — it's a text-side net, not a
root-cause guard.

**Fix:** in the Sarvam WS adapter (`orchestration/adapters/stt/sarvam.ts`), track the
wall-clock span from the first `speech_start` to the last `speech_end` of the current
adaptive-coalescing window, and require it to be long enough to plausibly contain the
transcript's word count (~150ms/word, 250ms floor) before calling `onTranscript`.
Below that, the transcript is silently dropped — it flows into the same stall-backstop
/ silence-reprompt path as genuine silence, not into the LLM turn or the garbled-text
reprompt.

**Why:** the input-audio gate (blanket energy threshold on frames fed to Sarvam) was
already tried and reverted once (regression: starved Sarvam of caller audio during
agent speech, broke normal-volume barge-in, calls 772→1320) — see `pipeline.ts` comment
at the streaming-STT feed site. Gating on the OUTPUT side (post-hoc duration vs. Sarvam's
own VAD signals) avoids re-touching that known-fragile input path entirely, and fails
open if VAD timestamps are ever missing (never silently drops a transcript it can't
measure).

**How to apply:** if new hallucination reports surface, tune `MIN_MS_PER_WORD` /
`MIN_PLAUSIBLE_SPEECH_MS` in that file rather than reintroducing an input-level gate.
