# Call orchestration fixes — 2026-09-13

This implements the four follow-ups from the September 12 audit. It does not
claim a measured latency reduction or parity with hosted voice platforms.

## Changed contracts

1. **Speech-safe input filtering.** Removed adaptive RMS calibration and
   attenuation from `NoiseCanceller`. The existing per-call continuous
   bandpass remains; immediate and quiet speech no longer become a learned
   noise floor. The agent toggle and browser bypass remain unchanged.
   This is not a neural denoiser or acoustic echo canceller: in-band fan,
   music and competing voices still require a separately evaluated processor.

2. **Vobiz delivery evidence.** The classic pipeline sends a named `checkpoint`
   after draining speech and awaits matching `playedStream`. Clear, close and
   a two-second acknowledgement timeout are explicit non-success outcomes.
   Local clear invalidates outstanding names immediately; delayed acknowledgements
   cannot complete another turn. Transcript history for ordinary replies and
   greetings uses confirmed complete jobs, not the full generated response.
   Underrun silence cannot substitute for missing speech bytes. Joined Cartesia
   continuation text belongs to its single playback job. Receipt-aware playback
   skips the extra timer-based tail drain. Squad handoffs preserve the hook.
   This is utterance/context-level evidence, not word alignment or proof that a
   human understood the sound. A missing receipt conservatively omits that text.
   Gemini Live and specialized system-message history writers are not migrated
   to this classic-pipeline history contract in this patch.

3. **Greeting input.** Nonempty caller finals during greeting playback enter a
   bounded, deduplicated queue and are coalesced after greeting cleanup. Stop/hold
   phrases may interrupt the greeting and bypass the echo-grace/word-floor rule.
   Greeting state by itself no longer discards input, including the first final
   received after playback. A conservative substantial exact-text echo heuristic
   remains; short replies and recognized stop requests bypass it. This heuristic
   is not acoustic echo cancellation and needs double-talk validation.

4. **Endpointing and queue ownership.** Initial sessions and squad handoffs
   resolve an explicit `sarvamEndOfSpeechSilenceMs` first, then an explicitly
   saved `asrEndpointingSilenceMs`. Omission remains null so adapter/environment/
   provider defaults apply; no materialized UI default is injected. Values and
   live updates share the adapter's 150–2000 ms range. Sarvam TTS queue waiting
   has a separate bounded deadline (30 seconds, or the configured stream timeout
   if larger); the provider first-byte/idle deadline starts after acquiring its
   serialization slot. Cancellation releases a queued waiter immediately without
   letting later requests overtake the active one. Queue expiry does not trigger
   a duplicate REST request. The playback consumer does not own a second
   first-byte deadline. Partial provider timeouts cannot count as complete text.

## Verification

- API suite: 172 files, 1,515 tests passed.
- API production bundle and `git diff --check`: passed.
- Typecheck remains blocked by existing LLM tool-choice/import declarations,
  nullable endpointing language and admin/callback/lead route errors. No new
  diagnostics remain in the changed implementation.
- Regression coverage includes soft/immediate input, queue cancellation/order,
  timeout ownership, greeting stop/retention, actual Vobiz socket event wiring,
  missing/late/cleared receipts, history evidence and joined Cartesia text.
- No production deployment, paid provider requests, live calls, listening test
  or concurrency benchmark was performed.

Before rollout, test immediate hello, soft replies, stop during greeting,
double-talk, missing acknowledgement, disconnect and mid-stream provider failure
using the same voice, language, model and carrier. Check lost/repeated words,
interruption stop time and acoustic-end-to-first-audible latency. General
backpressure, neural denoising/AEC and all specialized history writers remain
separate work; do not infer these are solved by the unit tests.

Protocol references: [Vobiz checkpoints](https://www.vobiz.ai/docs/xml/stream/checkpoint-event),
[Sarvam realtime STT](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming),
[Cartesia continuations](https://docs.cartesia.ai/build-with-cartesia/capability-guides/stream-inputs-using-continuations).
