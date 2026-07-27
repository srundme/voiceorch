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
- `high_vad_sensitivity=true` gives 0.5s silence boundary vs default ~1s — **use this; do NOT replace with fine-grained params**
- No partials emitted — force-finalize safety net relies only on END_SPEECH timing

## VAD tuning lessons (June 2026)

**DO NOT** raise `negative_frames_count` / `negative_frames_window` above ~0.5s:
- User-perceived latency = VAD silence boundary + Sarvam transcription time (100–700ms).
  With 0.8s VAD: 0.8 + 0.7 = 1.5s total → user notices "1 second lag".
  With 0.5s VAD: 0.5 + 0.2 = 0.7s → feels snappy.
- `STREAMING_BATCH_FALLBACK_MS` is now **8000ms** (last resort only). Real dead-WS detection
  is done by the heartbeat interval in sarvam.ts → `onConnectionDead` → immediate batch STT.
  Keep VAD short (0.5s) and rely on the heartbeat rather than a short fallback timer.

## Adaptive coalescing (June 2026)
- Fixed-150ms hold replaced with adaptive hold that self-calibrates per caller:
  fast speaker (<150ms avg pause) → 120ms, medium (<400ms) → 220ms, slow → 350ms.
- pauseHistory: last 5 mid-sentence pause durations; calibrated within 2–3 turns.
- SttFinalMetadata now carries `mergedSegments` and `pauseCount` — surfaced in utterances table.

## WS heartbeat / dead-connection detection (June 2026)
- Sarvam adapter tracks `lastMsgAt` + `inSpeechSegment`; 300ms interval checks for >3s silence during speech.
- Fires `sttObj.onConnectionDead?.()` → webcall.ts hook → immediate `process()` (batch STT fallback).
- StreamSTT interface has `onConnectionDead?: (() => void) | null` — set by caller after creation.
- Heartbeat interval cleared in `close()` to prevent leaks.

## Utterances table (June 2026)
- `lib/db/src/schema/utterances.ts` — one row per user turn; call_id FK, coalesced bool,
  mergedSegments, pauseCount, provider, latencyMs.
- Insert is fire-and-forget in `process()` right after `safetyNet.onFinal()`.
- Enables future analytics: avg pause per language, interruption rate, Tamil/English ratio.

**Two-VAD question (investigated, no race):** the pipeline feeds ALL caller frames to the Sarvam WS unconditionally on the streaming path — client energy VAD only drives barge-in/watchdog/safety-net, never gates the feed, never calls flush(), never finalizes turns; Sarvam server VAD (high_vad_sensitivity=0.5s + vad_signals) owns end-of-speech. Input-level gating existed once and was removed (calls 772→1320: gating starved Sarvam → barge-in impossible) — beware STALE comments claiming frames are gated during playback. Docs-recommended 60s-idle keep-alive already implemented (heartbeat tick, 15s idle → 200ms silence frame, outside speech segments). Turn-taking latency is a legitimate STACK, not a race: 0.5s server VAD + 30ms fast-flush (or 120-1200ms coalesce holds when final looks incomplete) + ≤300ms startSpeakingPlan cap. request_id from every WS response now captured → transcript/error logs + SttFinalMetadata.requestId → dashboard exec-log responsePayload (quote it to Sarvam support). Note: asrEndpointingSilenceMs only affects Azure, silently no-ops for Sarvam.
