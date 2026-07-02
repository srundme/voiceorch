---
name: Sarvam STT speech-duration hallucination guard — tried and reverted
description: An output-side speech_start→speech_end duration check was added to drop noise-hallucinated Sarvam transcripts, then fully reverted after it discarded ALL real speech.
---

**Do not reintroduce a speech_start→speech_end duration/word-count plausibility
check in the Sarvam adapter (`orchestration/adapters/stt/sarvam.ts`).** It was tried
(after call 1572's "Out of" hallucination during silence) and reverted immediately
(call 1573: zero transcripts in a 42s call despite clear caller speech incl. an
RMS-12706 barge-in) because it discarded genuine speech, not just noise.

**Why it failed:** Sarvam's own speech_start→speech_end window is NOT a reliable
proxy for how long a human actually took to say the words. Real production
measurements from call 1573: "Are you there?" (3 words) measured at only 442ms;
"Hello" at 150ms; a real 7-word utterance ("Tell me what is What is Snap?") at
780ms. All were rejected by a "150ms/word, 250ms floor" heuristic — the heuristic's
core assumption (Sarvam's VAD window ≈ actual speaking duration) is false in
practice; Sarvam's window is consistently much shorter than that.

**Status:** fully reverted (removed `segmentStartAt`/`segmentEndAt` tracking and
the plausibility check entirely) — adapter is back to emitting every coalesced
transcript from Sarvam as-is, same as before call 1572's fix was attempted.

**How to apply:** if the "Out of"-style silence-hallucination issue resurfaces,
do NOT retry a duration-based heuristic on Sarvam's own VAD timestamps — it's not
a trustworthy signal. Also do not reintroduce a blanket input-audio energy gate
(already tried/reverted once before this, for a different reason: starved Sarvam
of caller audio during agent speech, broke normal-volume barge-in, calls
772→1320 — see `pipeline.ts` comment at the streaming-STT feed site). Any future
attempt needs a text-side signal (extending `checkTranscriptQuality` in
`transcriptQuality.ts`) or corroboration from an independent energy/VAD source
that isn't Sarvam's own reported window, validated against real call logs across
multiple SHORT real utterances (not just the hallucination case) before shipping.
