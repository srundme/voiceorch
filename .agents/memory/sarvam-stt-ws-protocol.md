---
name: Sarvam STT WebSocket protocol
description: Exact wire format and valid models for Sarvam real-time STT WebSocket, confirmed by live API probing.
---

## Valid streaming models (WS close-4000 rejects all others)
- `saarika:v2.5` — valid for streaming + batch (recommended default)
- `saaras:v3` — valid for streaming + batch
- `saaras:v2.5` — **REJECTED** by streaming WS (close 4000: "Only 'saarika:v2.5' or 'saaras:v3' are supported"). Do not add to STREAMING_MODELS.

## Audio message format per chunk
Each PCM chunk must be WAV-wrapped (via pcmToWav) and sent as an AudioContent object:
```json
{ "audio": { "data": "<base64_WAV>", "encoding": "audio/wav", "sample_rate": 16000 } }
```
- `encoding` is an enum — only `"audio/wav"` accepted; `"pcm_s16le"` causes a Pydantic validation error.
- `audio` must be a dict/object — passing a plain base64 string causes `Input should be a valid dictionary or instance of AudioContent`.
- Field name `audio_chunk` is not recognized — causes `'audio' must not be None`.

**Why:** Confirmed by live Pydantic validation errors returned by the API during probe tests. The Sarvam Python SDK wraps each chunk before sending; our adapter must replicate this.

**How to apply:** In `sendAudioFrame`, always call `pcmToWav(chunk, 16000)` (already imported) before base64-encoding and wrapping in the AudioContent envelope.
