---
name: Webcall streamSTT.sendAudio invariant
description: streamSTT.sendAudio(chunk) is the only line that feeds audio to Sarvam's WebSocket; accidentally removing it during inEndGrace refactors silences STT completely.
---

## Rule
`streamSTT.sendAudio(chunk)` MUST be the first statement inside `if (streamSTT) { ... }` in the listening-path audio handler (webcall.ts). It must never be moved outside the block or omitted.

**Why:** Sarvam's streaming STT WebSocket only receives audio via this call. If it is absent, Sarvam fires zero VAD events and zero transcripts for the entire call — the call appears completely broken (0 user turns). The batch-STT fallback timer only starts when *energy drops after a speech run*, so a caller who speaks continuously until hangup bypasses it entirely.

**How to apply:** Whenever editing the `inEndGrace` guard position or restructuring the `if (streamSTT)` block, confirm `streamSTT.sendAudio(chunk)` is still the first line inside the block before committing.

## Stable constants (restored values)
- `BARGE_IN_END_GRACE_MS = 600` — original working value; 1200ms blocks too much user speech
- `WEB_TAIL_ECHO_MARGIN_MS = 100` — original working value
- `if (inEndGrace) return` goes BEFORE `if (streamSTT)`, not inside it
