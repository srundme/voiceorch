---
name: Webcall content-based echo detection
description: Why time-based transcript discard was replaced with isAgentEcho() token containment, and all hardening rounds applied.
---

## The rule

Never discriminate echo from genuine caller reply by **time** alone. Both arrive in the same ~600ms window post-agent-speech. Content is the correct axis: echo can only contain the agent's own words.

## What broke and why

Two stacked failures caused "speak twice" every turn:

1. `inEndGrace` hard-returned, so caller audio never reached Sarvam for the first 600ms after TTS ended.
2. Even after forwarding audio during inEndGrace, `lastUserSpeechStartAt` was only updated *after* the inEndGrace branch. So when Sarvam fired `onFinal`, the guard saw a stale speech_start from the previous turn and discarded the genuine response as "leftover echo."

## Fix round 1 — content echo detection (core)

- **Deleted** the `inEndGrace` early-return. Audio flows unconditionally.
- **Replaced** time guards in both primary STT `onFinal` and fallback STT handler with `isAgentEcho(text)`.
- **`isAgentEcho`**: fires only within `ECHO_CONTENT_WINDOW_MS=900ms` of last TTS chunk. Token containment ≥ `ECHO_SIM_THRESHOLD=0.6` against `recentAgentText` buffer. Tiebreaker for ≤2-token transcripts: loud caller frame → accept as genuine.
- **`normalizeIndic`**: NFC + strip ZWJ/ZWNJ + lowercase — ensures Tamil "சரி" matches across TTS vs STT encodings.

## Fix round 2 — three structural fixes

1. **`lastLoudFrameAt` timestamp** (not boolean `lastFrameWasLoud`) — boolean was overwritten to false by trailing silence frames before onFinal fires.
2. **`isAgentEcho` added to speaking (barge-in) branch** of both primary and fallback STT paths, after echoGraceUntil guard.
3. **`stripSsml()` at all 4 `recentAgentText.push` sites** — raw SSML markup prevented token matching. Applied together with `normalizeIndic()`.

## Fix round 3 — four latent bugs found in adjacent paths

**1. `AGENT_TEXT_BUFFER_MS` 3000 → 8000**
With push-at-sentence-start timing, sentences longer than ~1.65s had their buffer entry pruned before the echo could arrive (entry age at match ≈ TTS duration + 450ms + up to 900ms window). 3s buffer meant content-echo detection effectively never fired for normal-length final sentences. 8s covers max_sentence_duration + ECHO_CONTENT_WINDOW_MS + STT_finalize_latency.

**2. `pendingShortUtterance` echo check at replay time (was unfiltered)**
Short utterances (wc < wordsForInterruption) were saved during agent speech with NO echo check, then replayed straight into `process()` post-speech — reinstating the self-echo loop via the short-utterance channel. Fix: check `isAgentEcho(queued)` at replay time (post-speech). Do NOT check at save time: `lastLoudFrameAt` is only updated in the `!speaking` audio branch, making the tiebreaker stale during agent speech.

**3. `lastLoudFrameAt` uses `SPEECH_RMS_THRESHOLD` (400), not `bargeInRmsThreshold` (800)**
Post-AEC, a genuine short confirmation can land at 600–800 RMS — below barge-in threshold but above noise. Using 800 blinded the tiebreaker to that mid-band signal. Design biases toward accepting the caller (missed echo = one extra turn; missed genuine = caller repeats every turn).

**4. `stripSsml` regex: `</?[a-zA-Z][^>]*>` not greedy `<[^>]+>`**
The greedy form deleted literal angle-bracket text in agent scripts ("policy < 5 lakh > tier"), removing those tokens from the echo buffer and causing echo misses on financial scripts. SSML tags always start with a letter; the tag-specific pattern preserves bare `< >` text.

## Deferred: energy barge-in content gate (MEDIUM)

The energy barge-in path has no `isAgentEcho` check — there's no transcript available at the RMS trigger point. `echoGraceUntil` (sentence-rearm) covers the common case. A full fix requires tracking `lastStreamingPartial` and using it as the echo check input; deferred.

## How to apply

If "speak twice" re-emerges:
1. Check all 4 `recentAgentText.push` sites use `stripSsml(normalizeIndic(...))`.
2. Check `lastChunkSentAt` is updated in `sendAudio`.
3. Check `AGENT_TEXT_BUFFER_MS` (8s) is wider than the longest expected TTS sentence.
4. Check `isAgentEcho` runs in BOTH speaking and listening branches of both primary and fallback STT paths.
5. Check `pendingShortUtterance` replay uses `isAgentEcho(queued)` (at replay time, not save time).
6. Keep `echoGraceUntil` sentence-start re-arming — it guards energy barge-in during active TTS, a separate problem.
