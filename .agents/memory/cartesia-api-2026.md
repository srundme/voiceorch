---
name: Cartesia API 2026 surface
description: Docs-verified Cartesia STT/TTS API shapes (Cartesia-Version 2026-03-01) — endpoints, auth, generation_config, emotion enum, flush acks
---

Ground truth from Cartesia's official skill + live docs (fetch `docs.cartesia.ai/<page>.md` directly for authoritative OpenAPI/AsyncAPI schemas — e.g. `api-reference/tts/bytes.md`, `api-reference/stt/transcribe.md`, `use-the-api/api-conventions.md`).

## Batch STT
- Endpoint is `POST {base}/stt` (multipart form). An OpenAI-shaped `/v1/audio/transcriptions` path **does not exist** on Cartesia — our old adapter used it with model `whisper-1` (OpenAI's name), so batch Cartesia STT was dead until the 2026-07 rewrite.
- Model must be in the `ink-whisper` family (coerce anything else). `ink-2` (May 2026) is streaming-only (separate WS turn-based protocol), English-only.
- `language` is ISO-639-1 base code (`hi`, not `hi-IN`).
- WAV/MP3/etc containers are auto-decoded; raw PCM needs `encoding` + `sample_rate` query params.

## TTS controls (the big one)
- `voice.__experimental_controls` is **retired from the spec**. Sending legacy `["family:level"]` emotion arrays gets 400-rejected ("invalid emotion level: …") → our strip-and-retry fallback meant **emotion styling silently never applied** until migrated.
- Current home: top-level `generation_config` object — `speed` (double, **[0.6, 1.5]**, default 1), `volume`, `emotion` (**single enum string**, ~57 values incl. enthusiastic/sympathetic/calm/curious/content/sad — the LLM tag names are valid members, pass through directly).
- Top-level `speed` (slow/normal/fast ModelSpeed) is deprecated; don't use.
- `model_id` current enum: sonic-3.5, sonic-3, sonic-latest (+ dated snapshots like sonic-3.5-2026-05-04). sonic-2/turbo/english/multilingual are "older models" — kept in our allowlist for stored configs, unverified whether still accepted.
- Sonic 3.5: 42 languages incl. hi/ta/te/gu/kn/ml/mr/pa/bn — **no Odia**.

## Auth + versioning
- Current auth everywhere: `Authorization: Bearer <key>` (HTTP). `X-API-Key` is legacy — we send BOTH on TTS REST during transition. WS from servers: `?api_key=` query param (live-verified working); browsers use `?access_token=`.
- `Cartesia-Version` header required on EVERY request (we pin `2026-03-01` in both tts/cartesia.ts and stt/cartesia.ts — keep in sync). Versions ≥2026-03-01 return structured JSON errors (`error_code`, `request_id`).
- Base `api-india.cartesia.ai` is a live-verified regional endpoint (env-overridable via CARTESIA_BASE_URL); docs only mention api.cartesia.ai — don't "fix" it.

## WS protocol
- Per-flush completion ack is message type **`flush_done`** (`{type:"flush_done", flush_done:true, flush_id:N}`), not a per-flush "done". Adapter resolves flush waits on either.
- `max_buffer_delay_ms`, `flush`, `generation_config` all valid fields in WS transcript messages (same placement as REST).

**Why:** provider docs drift faster than adapter code; the emotion pipeline was double-broken (legacy mapping + retired field) with zero errors surfaced thanks to the retry fallback.
**How to apply:** any Cartesia adapter change → re-fetch the .md docs first; never trust old snippets. Related: [cartesia-emotion-control-fallback](cartesia-emotion-control-fallback.md) (the retry stays as belt-and-braces).
