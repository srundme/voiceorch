---
name: Webcall handler is fully separate from pipeline.ts
description: Features added to pipeline.ts are NOT available in webcall calls without duplication
---

**Rule:** Any orchestration feature (gender detection, salutation injection, etc.) added to `pipeline.ts` must ALSO be manually added to `artifacts/api-server/src/orchestration/telephony/webcall.ts`.

**Why:** The webcall handler has its own complete audio/STT/LLM/TTS loop. It does NOT call session.ts or pipeline.ts at all. Browser-based calls (`provider="webcall"`) and Vobiz/Twilio/Plivo telephony calls go through completely different code paths. Check production logs for `provider="webcall"` vs `provider="vobiz"` to identify which path a call used.

**How to apply:** When adding pipeline features: (1) add to pipeline.ts, (2) check webcall.ts has equivalent logic. Key webcall state: `let systemPrompt` (mutable, per-call), `history` array, `audioChunks` for VAD buffering, `recording` for audio capture. Browser audio comes in as 16kHz PCM — downsample with `downsample16to8` before feeding to gender detector.

**Multi-step tool calling:** Both paths support chaining tools in one user turn (e.g. check_availability → book_appointment → end_call), but implement it differently and BOTH must stay attached-on-every-turn. webcall.ts uses a `while(true)` loop around the LLM turn (resets streaming state each iteration, pushes `[Tool result for X]: …` to history, `continue`s with tools still attached; an iteration cap flips `attachTools=false` for a final narration turn). pipeline.ts uses recursion: `continueWithToolResult(name, result, depth)` re-attaches `toolDefs`+`onToolCall` and recurses on a chained call (depth-capped). The classic bug is the follow-up turn dropping tool defs so only the first tool per turn runs — keep tools attached.
