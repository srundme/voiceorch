---
name: Webcall content-based echo detection
description: Why time-based transcript discard was replaced with isAgentEcho() token containment, and what the stacked failure was.
---

## The rule

Never discriminate echo from genuine caller reply by **time** alone. Both arrive in the same ~600ms window post-agent-speech. Content is the correct axis: echo can only contain the agent's own words.

## What broke and why

Two stacked failures caused "speak twice" every turn:

1. `inEndGrace` hard-returned, so caller audio never reached Sarvam for the first 600ms after TTS ended.
2. Even after the June 24 fix forwarded audio during inEndGrace, `lastUserSpeechStartAt` was only updated *after* the inEndGrace branch. So when Sarvam fired `onFinal`, the guard `Date.now() - speakingEndedAt < BARGE_IN_END_GRACE_MS && lastUserSpeechStartAt <= speakingEndedAt - ECHO_DISCARD_OVERLAP_MS` saw a stale speech_start from the previous turn (>1.5s ago) and discarded the genuine response as "leftover echo." Audio flowed, STT transcribed correctly, then the callback threw it away.

## Fix applied

- **Deleted** the `inEndGrace` early-return. Audio flows unconditionally to streamSTT on every `!speaking` frame.
- **Replaced** `BARGE_IN_END_GRACE_MS`/`ECHO_DISCARD_OVERLAP_MS` time guards in both primary STT `onFinal` and fallback STT handler with `isAgentEcho(text, lastFrameWasLoud)`.
- **`isAgentEcho`**: only fires within `ECHO_CONTENT_WINDOW_MS=900ms` of last TTS chunk. Uses token containment ratio (|intersection|/|transcript tokens|) ≥ `ECHO_SIM_THRESHOLD=0.6` against `recentAgentText` buffer (3s retention). Tiebreaker for ≤2-token transcripts: full-energy (`lastFrameWasLoud`) frames are accepted as genuine (AEC attenuates echo 6–12 dB).
- **`normalizeIndic`**: NFC + strip ZWJ/ZWNJ + lowercase before tokenizing — ensures Tamil "சரி" matches across TTS vs STT encodings.
- **`recentAgentText`** pushed at: sentence_start in main TTS loop, clarification path, `speakFinalUtterance`, and greeting playback.
- **`lastFrameWasLoud`** updated in the `!speaking` audio handler before the streamSTT path.

## Why

Containment (not Jaccard) is the right metric because echo is a *subset* of what the agent said. Short single-word echoes that Jaccard misses are caught by containment.

## How to apply

If the "speak twice" symptom re-emerges, check: (1) is `recentAgentText` being populated in all TTS paths? (2) is `lastChunkSentAt` being updated in `sendAudio`? (3) is `ECHO_CONTENT_WINDOW_MS` wide enough for the TTS provider's playback latency? Also keep `echoGraceUntil` sentence-start re-arming — it guards energy barge-in during active TTS, which is a separate problem.
