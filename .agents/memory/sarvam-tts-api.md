---
name: Sarvam TTS API quirks
description: Sarvam Bulbul TTS — persistent WebSocket, HTTP fallback, barge-in close
---

## Rules

**Valid models:** `bulbul:v3` (recommended), `bulbul:v3-beta`, `bulbul:v2`. Coerce `v3-beta` → `v3` on WS/stream.

**Preference:** WebSocket → HTTP stream → REST (fillers).

**WebSocket** `wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true`
- Header: `api-subscription-key`
- **Config first:** `{ type:"config", data:{ speaker, target_language_code, speech_sample_rate:"16000", output_audio_codec:"linear16", min_buffer_size:50, max_chunk_length:200, pace? } }`
- **Text:** `{ type:"text", data:{ text } }` — prefer &lt;500 chars
- **Flush** after text: `{ type:"flush" }`
- **Ping** every ~30s on idle warm sockets (server idle-closes ~1 min)
- **Audio:** `{ type:"audio", data:{ audio:"&lt;base64&gt;" } }`
- **Done:** `{ type:"event", data:{ event_type:"final" } }`
- **Keep socket open** across utterances; park as warm after `final`
- **Parallel prefetch:** if WS is busy synthesizing N, N+1 uses HTTP stream (do not steal warm socket — causes firstByte spikes)
- **Barge-in:** close WS on abort; open fresh for next reply (no server cancel)
- **Reconnect:** exponential backoff on 1006/1011/network; **never** blind-retry 4xxx auth/quota

**Speakers:** catalog names + Creative Studio clone speaker ids. Reject Cartesia UUIDs only (hyphenated custom clone ids are OK).

**HTTP stream** `POST /text-to-speech/stream` — `linear16` @ 16 kHz. Cap 3500.
**REST** `POST /text-to-speech` — base64 WAV, strip 44-byte header. Cap 2500.

Never call `/text-to-speech-streaming` (404). Never send pitch/loudness on v3. Odia = `od-IN`.

**Voice cloning:** no public self-serve clone REST API — create in Creative Studio, register speaker id via `POST /voices/sarvam-register`.
