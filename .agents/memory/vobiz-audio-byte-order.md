---
name: Vobiz audio byte order
description: Vobiz uses little-endian LINEAR16 PCM for BOTH inbound and outbound audio — no byte-swapping needed in either direction.
---

Vobiz sends and receives audio in **little-endian** LINEAR16 PCM 8 kHz on both sides of the WebSocket connection — despite `audio/x-l16` being nominally big-endian per RFC 2586.

**Rule:** Pass buffers through as-is (no byte-swap) in both directions:
- Inbound `media` events (caller → STT): `Buffer.from(msg.media.payload, "base64")` directly to `pipeline.onRawPcm8kIn()`
- Outbound `playAudio` events (TTS → caller): `pcmChunk.toString("base64")` directly as payload

**Why:** Byte-swapping outbound caused complete silence; byte-swapping inbound caused STT to receive garbled audio and never transcribe. Removing both swaps fixed audio end-to-end.

**How to apply:** Any future change to `vobiz.ts` audio handling — do NOT add byte-swap loops. The `contentType: "audio/x-l16"` header is still correct and required (without it, Vobiz mis-decodes as µ-law → tractor noise).
