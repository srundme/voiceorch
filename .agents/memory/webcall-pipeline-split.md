---
name: Webcall handler is fully separate from pipeline.ts
description: Features added to pipeline.ts are NOT available in webcall calls without duplication; streaming STT fallback pattern critical
---

**Rule:** Any orchestration feature added to `pipeline.ts` must ALSO be manually added to `artifacts/api-server/src/orchestration/telephony/webcall.ts`.

**Why:** The webcall handler has its own complete audio/STT/LLM/TTS loop. It does NOT call session.ts or pipeline.ts at all. Browser-based calls and Vobiz/Twilio/Plivo telephony calls go through completely different code paths.

**How to apply:** When adding pipeline features: (1) add to pipeline.ts, (2) check webcall.ts has equivalent logic. Key webcall state: `let systemPrompt` (mutable, per-call), `history` array, `audioChunks` for VAD buffering, `recording` for audio capture. Browser audio comes in as 16kHz PCM — downsample with `downsample16to8` before feeding to gender detector.

**Streaming STT fallback (critical):** Both paths now support streaming STT. The `onClose` callback MUST null out `streamSTT`. Without it, audio silently goes to the dead socket forever — Sarvam saaras:v3 can error immediately with `"Error in Pipeline : 'text'"` for certain languages (observed: ta-IN), closing the socket and making the agent deaf for the whole call.

**Multi-step tool calling:** Both paths support chaining tools in one user turn. webcall.ts uses a `while(true)` loop; pipeline.ts uses `continueWithToolResult` recursion. Both must keep tools attached on every iteration — the classic bug is dropping tool defs on the follow-up turn.
