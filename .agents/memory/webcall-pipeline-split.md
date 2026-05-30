---
name: Webcall handler is fully separate from pipeline.ts
description: Features added to pipeline.ts are NOT available in webcall calls without duplication
---

**Rule:** Any orchestration feature (gender detection, salutation injection, etc.) added to `pipeline.ts` must ALSO be manually added to `artifacts/api-server/src/orchestration/telephony/webcall.ts`.

**Why:** The webcall handler has its own complete audio/STT/LLM/TTS loop. It does NOT call session.ts or pipeline.ts at all. Browser-based calls (`provider="webcall"`) and Vobiz/Twilio/Plivo telephony calls go through completely different code paths. Check production logs for `provider="webcall"` vs `provider="vobiz"` to identify which path a call used.

**How to apply:** When adding pipeline features: (1) add to pipeline.ts, (2) check webcall.ts has equivalent logic. Key webcall state: `let systemPrompt` (mutable, per-call), `history` array, `audioChunks` for VAD buffering, `recording` for audio capture. Browser audio comes in as 16kHz PCM — downsample with `downsample16to8` before feeding to gender detector.
