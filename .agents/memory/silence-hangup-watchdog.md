---
name: Silence-hangup watchdog
description: Silence-timeout hangups must be fed by raw caller speech energy (not just transcripts) and speak a check-in before ending
---

# Silence-hangup watchdog

**Rule:** The per-agent silence-hangup timer must be kept alive by raw caller speech ENERGY on BOTH STT paths (batch and streaming), not just by transcript callbacks — and a legitimate expiry must speak an in-language "are you still there?" check-in before hanging up, recording the end as `silence_timeout`, never "completed".

**Why:** Streaming STT (Sarvam) can go completely quiet (stale WS, codemix mistranscription, low energy) while the caller is audibly speaking. When the timer was reset only from partial/final callbacks, the platform "heard silence", hung up mid-speech with no warning, and mislabeled the end "Conversation completed" — making the drop undiagnosable.

**How to apply:** `SilenceWatchdog` (`orchestration/endpointing.ts`) owns the logic: `onSpeechEnergy()` is timestamp-only (no timer churn per audio frame); expiry re-arms if agent is busy or speech was recent, otherwise reprompts once (`inactivityReprompt`, 9 langs) then gives up (`inactivityFarewell`). Pipeline feeds energy gated on `hasSpeech && !isPlaying && !isSendingTtsAudio` (echo guard). The pipeline's `endReasonHint` threads the true reason into session.ts's `endRawReason` derivation — any new "pipeline ends the call itself" path should set `endReasonHint` or the end-log defaults to completed/user_hangup.

**Companion fix (script rigidity):** the anti-repeat "advance to the next point" nudge must be intent-gated — only fire on genuine bare acknowledgements; hold-requests ("wait/one minute", ta/hi incl. romanized) get a wait directive, questions get answer-first (`buildAntiRepeatNudge` in `conversationDiscipline.ts`).
