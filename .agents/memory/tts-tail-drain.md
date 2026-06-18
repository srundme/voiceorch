---
name: TTS final-words clipping on call teardown
description: Symptom + durable rules for why goodbye/end-of-turn audio gets cut off and what every teardown path must do
---

# TTS final words clipped on teardown

**Symptom:** the last words of a spoken response (most visibly the goodbye, but
also end-of-turn responses on hangup-after-call agents, transfers, and inactivity
farewells) are cut off right as the call ends or returns to listening.

**Root cause (durable):** the per-sentence playback loop resolves as soon as the
last audio chunk is *handed off*, not when it finishes *playing*. Anything that
ends the call (`onCallEnd`) or stops audio immediately after will clip whatever
is still buffered downstream. Terminal/one-shot paths bypass the normal loop's
tail handling, so they each have to replicate it.

**Two paths need DIFFERENT drains — do not assume one fix covers both:**
- **Telephony:** the carrier holds ~100-300ms in a jitter buffer. A passive wait
  (sleep) before teardown is sufficient.
- **Web (browser AudioContext):** a passive wait does NOT help — the timeline
  must be physically extended by *sending real silence frames* after the last
  word, plus padding the buffer with trailing silence.

**Rules to apply when touching call audio:**
1. Every path that calls `onCallEnd()`/hangup right after speaking must drain the
   tail first. On telephony this includes the hangup-after-LLM-call path, not
   just the explicit goodbye/end_call paths — it's easy to miss.
2. Echo grace protects the START of playback by default. It must ALSO be re-armed
   at EVERY playback exit (every place that flips the speaking flag off —
   including short direct branches like garbled-transcript clarification,
   guardrail canned responses, and the IVR greeting), or the agent's own trailing
   echo returns via STT and triggers a spurious barge-in / new turn that clips
   the closing words. Re-arming at only the main turn loops is incomplete.
3. Genuine barge-in must survive: gate only *non-semantic* streaming interrupts on
   the echo-grace window; explicit interrupt intents (e.g. "stop") bypass it,
   since our own audio never utters them.
4. Echo grace has both a START and an END window, and BOTH detection paths need
   it. On the web path the energy-based barge-in already honored start grace, but
   the streaming-STT barge-in branch (primary AND fallback) did not — self-echo
   transcribed during the start window would set `interrupted=true` and clip the
   tail. Any place that can flip an interrupt flag during playback must apply the
   same non-semantic start/end echo gate; fixing only one detector is incomplete.
5. Final-flush gate must be a non-empty `.trim()` check, never a length gate
   (`tail.length >= 2` silently drops one-char/short tails like "Ok"/"K"). At
   end-of-stream prefer the remainder from re-running extractSentences on the
   fully-cleaned full reply over the raw token buffer (the token stream can end a
   few words early). Derive the flushed tail AND the stored history turn from the
   SAME cleaned full-reply text so memory equals what was actually spoken. webcall
   already did this; pipeline.ts had the length gate + separate derivations in BOTH
   the main turn and continueWithToolResult — keep all flush sites in parity.
