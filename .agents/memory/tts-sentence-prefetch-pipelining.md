---
name: TTS sentence-prefetch pipelining
description: How the multi-sentence turn TTS playback pipeline overlaps synthesis with playback, and the ordering constraint that makes it safe.
---

Multi-sentence turns previously synthesized sentence N+1 only after sentence N's
playback fully finished, causing an audible ~130-260ms gap between sentences
(TTS firstByteMs was fully exposed between sentences instead of being hidden
behind the prior sentence's playback).

Fix: split the old single `playSentence` implementation into a synthesis phase
(`startSentenceSynthesis` — starts the TTS network fetch immediately, only does
byte-alignment, returns a job handle) and a playback/drain phase
(`drainSentenceJob` — recording, ambient mixing, wire encoding, real-time
pacing). Both turn sentence-queues (`processTurn`, `continueWithToolResult`)
now call `startSentenceSynthesis` at *enqueue* time instead of when the player
reaches that sentence, so sentence N+1 synthesizes while N is still playing.

**Why the split, not just "prefetch and play whenever":** recording
(`addAgentChunk`) and raw-PCM ambient mixing (`mixIntoPcm16k`, webcall path)
are real-clock, playback-order operations. If they ran during synthesis
instead of during drain, prefetching sentence N+1 while N is still playing
would corrupt the recording's chronology and desync ambient mixing against a
stream position that isn't "now" yet. Mulaw ambient mixing was already
correctly done at real send-time and is untouched.

**How to apply:** any future change to per-sentence TTS behavior (new
provider quirk, new telemetry, new pacing rule) must go into the right phase:
network/byte-alignment logic → `startSentenceSynthesis`; anything with a
real-world side effect or that must reflect true "now" → `drainSentenceJob`.
Single-shot playback call sites (greeting, IVR, hold/transfer messages,
stall reprompts) are unaffected — they still go through `playSentence(text)`,
which is just `playJob(startSentenceSynthesis(...))`.

Side note: the "TTS response" log latency now reflects pure synthesis time
(request→network response), not synthesis+playback-wait as before — this was
the more-accurate metric semantics we wanted anyway.
