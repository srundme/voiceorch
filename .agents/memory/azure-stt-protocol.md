---
name: Azure STT streaming protocol
description: Required headers for Azure Speech WebSocket and confidence filter pitfalls
---

# Azure STT Streaming Protocol

## The rule
Every message sent TO Azure Speech WebSocket — both text frames (speech.config, speech.context) and binary audio frames — MUST include an `X-RequestId` header. Omitting it causes an immediate 1002 close with reason `"Missing/Empty header: 'X-RequestId' for message 'audio'"`.

**Why:** Azure's streaming protocol treats every message as part of a stateful session identified by the request ID. Without it the server rejects the frame at the protocol level before any speech processing.

**How to apply:** Generate one UUID per connection (`randomUUID().replace(/-/g,"").toUpperCase()`), pass it to every `textFrame()` and `audioFrame()` call. The same ID is reused for all frames in the session.

## Confidence filter pitfall
Azure batch STT confidence scores for Indic languages (ta-IN, hi-IN, etc.) are frequently 0.2–0.35 — well below the 0.40 default threshold used for other providers. Applying the confidence filter in batch mode silently drops all valid transcripts.

**Fix:** In batch mode, rely solely on `RecognitionStatus === "Success"` as the gate. Return the transcript if it's non-empty; skip the confidence check entirely. In streaming mode, cap the effective threshold at 0.15 (`Math.min(configured, 0.15)`) to allow low-confidence Indic results through.
