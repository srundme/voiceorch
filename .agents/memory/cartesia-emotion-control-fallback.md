---
name: Cartesia emotion voice-control fallback
description: Cartesia can reject __experimental_controls.emotion levels with a 400; a single-sentence TTS error must never be treated as call-fatal
---

Cartesia's `__experimental_controls.emotion` accepted levels are not stable —
it started rejecting `positivity:medium` with `400: invalid emotion level:
medium` in production, killing every call where the agent used an emotion
tag mapping to that level.

**Fix pattern (applies to any TTS provider-specific voice control):**
1. Detect the provider's "invalid voice controls" error by message pattern.
2. Retry the SAME sentence once with the controls stripped (not the whole
   turn/call) — covers both WS and REST code paths independently.
3. Separately, make sure the pipeline's per-sentence TTS catch block never
   calls `onFatalError`/ends the call for a TTS synthesis failure — treat it
   as "skip this sentence's styling" and keep playing subsequent sentences.
   Before this fix, `pipeline.ts`'s main turn playTask called
   `config.onFatalError?.()` on ANY TTS error, so even a successfully-retried
   provider-side error class would still have ended the call if the retry
   itself weren't added at the adapter level.

**Why:** provider "supported enum values" drift silently over time (docs vs.
actual API behavior can diverge), and a per-sentence styling failure is not
equivalent in severity to STT/LLM failures that leave the turn with no
content at all — don't conflate them under the same fatal-error path.
