---
name: Lost-turn STT force-flush backstop
description: One-shot pipeline flush() when Sarvam sends VAD speech_start but no interim/final/speech_end
---
Rule: the pipeline MAY call streamSTT.flush(), but ONLY via the lost-turn backstop in pipeline.ts (armVadFlushBackstop): armed on VAD speech_start, disarmed by ANY interim/final/speech_end, fires once after 2s (VAD_FLUSH_BACKSTOP_MS) with a 5s cooldown, and only while listening (not playing/processing).

**Why:** Sarvam occasionally emits speech_start then nothing (prod calls 4831/4833) → caller utterance lost until the 10s stall reprompt. The old blanket "pipeline never calls flush()" invariant (calls-772→1320 regression = flush racing Sarvam VAD on normal turns) is preserved for normal turns because the backstop can only fire when Sarvam has been silent 2s+ after its own speech_start.

**How to apply:** never add other pipeline flush() call sites; if lost turns persist, tune VAD_FLUSH_BACKSTOP_MS, don't add new flush paths. Exec log marker: "Lost-Turn Force Flush". Related: coalesce-hold timer re-checks playback state at fire and drops pure acks if agent is speaking (backchannel_during_playback).
