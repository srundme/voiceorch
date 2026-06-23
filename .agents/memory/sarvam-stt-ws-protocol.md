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
{ "audio": { "data": "<base64 raw PCM>", "encoding": "audio/wav", "sample_rate": 16000 } }
```
- `audio` is a **nested object** (AudioContent), NOT a plain base64 string
- `encoding` enum MUST be `"audio/wav"` — `"pcm_s16le"` is rejected with Pydantic validation error
- The actual codec is controlled by URL param `input_audio_codec=pcm_s16le`; send raw PCM as base64, no WAV header needed
- Confirmed via live WebSocket probe (June 2026): flat format → "Input should be a valid dictionary or instance of AudioContent"; pcm_s16le encoding → "Input should be 'audio/wav'"

## Server → client messages (JSON text)
Per official docs (confirmed June 2026):
```json
{ "type": "speech_start" }
{ "type": "speech_end" }
{ "type": "transcript", "data": { "transcript": "..." } }
{ "type": "error",      "data": { "message": "..." } }
```
- `"transcript"` is the final — no partials. Adapter also handles legacy `"data"` type as fallback.
- `"speech_start"` / `"speech_end"` are VAD signals when `vad_signals=true`. Adapter also handles legacy `"events"` + `signal_type`.
- **Do NOT use `"events"`/`"data"` as primary type strings** — those were guessed wrong in the initial implementation and produced zero transcripts.

## Batch API
POST `https://api.sarvam.ai/speech-to-text`
- Multipart form: `file` (WAV blob), `model`, `language_code`
- Response: `{ transcript: string }`

## Best practices for voice agents
- Use `saaras:v3` + `mode=codemix` for Tamil+English mixed speech
- `high_vad_sensitivity=true` gives 0.5s silence boundary vs default ~1s
- No partials emitted — force-finalize safety net relies only on END_SPEECH timing
