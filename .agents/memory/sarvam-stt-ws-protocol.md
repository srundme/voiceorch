---
name: Sarvam STT WebSocket protocol
description: Wire format and valid models for Sarvam real-time STT WebSocket, from official docs (rebuilt June 2026).
---

## Valid models
- `saaras:v3` — recommended; supports `mode` parameter (codemix, transcribe, verbatim, translit)
- `saarika:v2.5` — legacy streaming + batch; no `mode` support
- `saaras:v2.5` — legacy; accepted by WS but not recommended

## WebSocket connection
URL: `wss://api.sarvam.ai/speech-to-text/ws?<params>`
Auth: header `api-subscription-key: <key>` (NOT query param)

Query params:
- `model` — `saaras:v3` or `saarika:v2.5`
- `language_code` — BCP-47, e.g. `ta-IN`, `hi-IN`. Note: Odia = `od-IN` (not `or-IN`)
- `mode` — `codemix` (Tamil+English mixing), `transcribe`, `verbatim`, `translit` (saaras:v3 only)
- `sample_rate` — `16000` or `8000`
- `input_audio_codec` — `pcm_s16le` for raw PCM (no WAV wrapping per chunk needed)
- `high_vad_sensitivity` — `true` → 0.5s silence boundary (best for voice agents)
- `vad_signals` — `true` → emits START_SPEECH / END_SPEECH events

## Audio message format (per chunk, JSON text)
```json
{ "audio": "<base64 raw PCM>", "encoding": "pcm_s16le", "sample_rate": 16000 }
```
- Send raw PCM directly as base64 — NO WAV header wrapping needed (unlike old protocol)
- `encoding` value is `"pcm_s16le"` (not `"audio/wav"`)
- `audio` is a plain base64 string (not a nested object like the old AudioContent envelope)

**Why changed:** Old adapter used WAV-wrapped AudioContent `{ audio: { data, encoding, sample_rate } }` based on probing the old API. Official docs (June 2026) show the new flat format with `pcm_s16le` codec.

## Server → client messages (JSON text)
```json
{ "type": "events", "data": { "signal_type": "START_SPEECH" | "END_SPEECH" } }
{ "type": "data",   "data": { "transcript": "..." } }
```
- Only `type: "data"` is a final transcript — there are NO interim/partial messages
- `type: "events"` carries VAD signals (useful for latency tracking, not needed for barge-in)

## Batch API
POST `https://api.sarvam.ai/speech-to-text`
- Multipart form: `file` (WAV blob), `model`, `language_code`
- Response: `{ transcript: string }`

## Best practices for voice agents
- Use `saaras:v3` + `mode=codemix` for Tamil+English mixed speech
- `high_vad_sensitivity=true` gives 0.5s silence boundary vs default ~1s
- No partials emitted — force-finalize safety net relies only on END_SPEECH timing
