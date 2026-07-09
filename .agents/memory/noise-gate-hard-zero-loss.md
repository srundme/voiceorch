---
name: Noise gate must attenuate, never hard-zero
description: Why the telephony noise-cancellation gate erased one-word caller replies and the rule for gating audio before STT
---

# Noise gate must attenuate, never hard-zero

**Rule:** Any noise gate applied to caller audio BEFORE it reaches STT must (a) attenuate below-threshold frames (e.g. scale to ~15%), never replace them with pure digital silence, and (b) hold the gate open for a hangover window (~100 ms) after each speech frame.

**Why:** The adaptive gate in the telephony noise canceller hard-zeroed 20 ms frames below `noiseFloor × ratio`. Short/soft utterances ("yes", "okay") straddle the threshold — their onset frames were zeroed before ANY STT provider saw them, so the loss was provider-independent (both Sarvam and Deepgram missed the same word, call 2039). Pure silence also breaks provider VADs that latch onto residual signal.

**How to apply:** When debugging "caller said X but nothing was transcribed" on live calls with noise cancellation ON, suspect the gate first — it runs upstream of every provider. Toggle-OFF behavior must stay byte-identical (the gate simply isn't called).

**Related:** the tail-echo guard used to discard ALL finals inside its post-playback window on time alone — it is now content-aware (discards only on isSelfEcho match), and every echo-guard discard writes a "Transcript Discarded" warning row (component STT) to the call execution log, so future losses are diagnosable from the dashboard Logs tab alone.
