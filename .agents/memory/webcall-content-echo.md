---
name: Webcall content-based echo detection
description: Why time-based transcript discard was replaced with isAgentEcho() token containment, and the three hardening rounds applied.
---

## The rule

Never discriminate echo from genuine caller reply by **time** alone. Both arrive in the same ~600ms window post-agent-speech. Content is the correct axis: echo can only contain the agent's own words.

## What broke and why

Two stacked failures caused "speak twice" every turn:

1. `inEndGrace` hard-returned, so caller audio never reached Sarvam for the first 600ms after TTS ended.
2. Even after forwarding audio during inEndGrace, `lastUserSpeechStartAt` was only updated *after* the inEndGrace branch. So when Sarvam fired `onFinal`, the guard saw a stale speech_start from the previous turn and discarded the genuine response as "leftover echo." Audio flowed, STT transcribed correctly, then the callback threw it away.

## Fix round 1 — content echo detection

- **Deleted** the `inEndGrace` early-return. Audio flows unconditionally.
- **Replaced** time guards in both primary STT `onFinal` and fallback STT handler with `isAgentEcho(text)`.
- **`isAgentEcho`**: fires only within `ECHO_CONTENT_WINDOW_MS=900ms` of last TTS chunk. Token containment ≥ `ECHO_SIM_THRESHOLD=0.6` against `recentAgentText` buffer (3s retention). Tiebreaker for ≤2-token transcripts: loud caller frame → accept as genuine (AEC attenuates echo 6–12 dB).
- **`normalizeIndic`**: NFC + strip ZWJ/ZWNJ + lowercase — ensures Tamil "சரி" matches across TTS vs STT encodings.

## Fix round 2 — three hardening items (June 24 follow-up)

**1. `lastLoudFrameAt` timestamp instead of boolean**

`lastFrameWasLoud` (boolean) was overwritten to `false` by trailing silence frames before Sarvam's `onFinal` fires — the tiebreaker always saw `false` for short confirmations like "சரி". Replaced with `lastLoudFrameAt: number`; the audio path sets `if (rms > bargeInRmsThreshold) lastLoudFrameAt = Date.now()`. Inside `isAgentEcho()`, tiebreaker is `const callerWasLoud = lastLoudFrameAt > 0 && (Date.now() - lastLoudFrameAt) < ECHO_CONTENT_WINDOW_MS`. The timestamp survives the silence gap before transcript delivery.

**2. `isAgentEcho` gate in the speaking (barge-in) branch**

Previously `isAgentEcho` only ran in the post-speech (listening) branch. If `echoGraceUntil` expired mid-TTS but AEC hadn't adapted, the agent's own words could trigger a false barge-in. Now both the primary STT speaking branch and the fallback STT speaking branch check `!semanticOverride && isAgentEcho(text)` immediately after the `echoGraceUntil` guard. Semantic overrides still bypass.

**3. `stripSsml()` before every `recentAgentText.push`**

TTS text often contains SSML tags (`<break>`, `<prosody>`, etc.). Storing raw markup prevented token matching against plain STT output. Added `stripSsml()` helper (strips `<[^>]+>`, collapses whitespace) applied together with `normalizeIndic()` at all 4 push sites: clarification phrase, per-sentence playback loop, `speakFinalUtterance`, and greeting playback.

## Why

Containment (not Jaccard) is the right metric — echo is a *subset* of what the agent said. Short single-word echoes that Jaccard misses are caught by containment.

## How to apply

If "speak twice" re-emerges, check: (1) all 4 `recentAgentText.push` sites use `stripSsml(normalizeIndic(...))`, (2) `lastChunkSentAt` is updated in `sendAudio`, (3) `ECHO_CONTENT_WINDOW_MS` is wide enough for TTS playback latency, (4) `isAgentEcho` is gated in BOTH speaking and listening branches in both primary and fallback STT paths. Keep `echoGraceUntil` re-arming — it guards energy barge-in during active TTS, a separate problem.
