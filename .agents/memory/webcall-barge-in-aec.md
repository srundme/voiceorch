---
name: Webcall barge-in AEC threshold
description: Webcall barge-in was silently much harder to trigger than telephony due to two pipeline.ts bugs
---

## The rule
Webcall barge-in requires two independent fixes from the telephony path:
1. **Threshold**: use `BARGE_IN_WEBCALL_AEC_THRESHOLD` (~400), NOT the telephony default 1200
2. **Frame cap**: the 8-frame (~160 ms) cap must apply to ALL `!respectHoldUntil` streaming paths, not just `useAdaptive` (telephony)

## Why
`streamingCarrier = !respectHoldUntil && telephonyProvider !== "webcall"` → false for webcalls.
`useAdaptive = streamingCarrier && isSendingTtsAudio` → also false.

This caused two silent problems:
- **Threshold 1200**: anti-echo bar designed for telephony carriers that echo TTS back. Browser AEC cancels agent audio before it reaches the pipeline, so 1200 is 3–4× too high for a normal browser mic.
- **Frame count 40 (800 ms)**: the streaming frame-count cap (`if (useAdaptive)`) never ran for webcalls. Default formula = `Math.max(bargeInMinFrames, wordsForInterruption×20)` = `Math.max(3, 40)` = 40 frames = **800 ms** of sustained loud voice needed. Only agents with a Stop Speaking Plan configured got the lower bargeInMinFrames value.

**Why:** `BARGE_IN_ENERGY_THRESHOLD=1200` and the frame cap were both telephony-only mitigations applied universally. Webcall (browser AEC) needs neither.

## How to apply
- `isWebcallStreaming = !respectHoldUntil && telephonyProvider === "webcall"`
- If `isWebcallStreaming && effectiveThreshold > BARGE_IN_WEBCALL_AEC_THRESHOLD`: cap it
- Frame cap condition: `!respectHoldUntil` (all streaming paths), NOT `useAdaptive` (telephony-only)
- `BARGE_IN_WEBCALL_AEC_THRESHOLD` is env-tunable; default 400

Diagnostic: look for "webcall energy barge-in monitor" log (same fields as telephony "energy barge-in monitor").
