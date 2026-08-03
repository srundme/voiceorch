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
- **Aug 2026 incident: do NOT wrap each chunk in a real WAV container.** A spec claimed per-chunk `pcmToWav()` wrapping was the fix for garbled transcripts; deploying it produced ZERO transcripts on live calls (VAD fired, no transcript messages) and was reverted same day. Raw PCM + `input_audio_codec=pcm_s16le` is the proven-working format — never "fix" it without a live probe first.

## saaras:v4 — announced Jul 30 2026, streaming UNSTABLE (Aug 1 2026)
Live call on v4 showed repeated "2s of speech, zero WS activity" backstop fires and one fully lost turn (no transcript ever). v3 on the same account minutes earlier was fast. Keep v3 as platform default/recommended; re-test v4 before promoting.

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
- `high_vad_sensitivity=true` gives 0.5s silence boundary vs default ~1s — **use this instead of hand-tuning the silence-boundary params** (`negative_frames_count`/`window`). This does NOT extend to `first_turn_min_speech_frames`, which the preset leaves at 8 — see below.
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

**Two-VAD question (investigated, no race):** the pipeline feeds ALL caller frames to the Sarvam WS unconditionally on the streaming path — client energy VAD only drives barge-in/watchdog/safety-net, never gates the feed, never calls flush(), never finalizes turns; Sarvam server VAD (high_vad_sensitivity=0.5s + vad_signals) owns end-of-speech. Input-level gating existed once and was removed (calls 772→1320: gating starved Sarvam → barge-in impossible) — beware STALE comments claiming frames are gated during playback. Docs-recommended 60s-idle keep-alive already implemented (heartbeat tick, 15s idle → 200ms silence frame, outside speech segments). Turn-taking latency is a legitimate STACK, not a race: 0.5s server VAD + 30ms fast-flush (or 120-1200ms coalesce holds when final looks incomplete) + ≤300ms startSpeakingPlan cap. request_id from every WS response now captured → transcript/error logs + SttFinalMetadata.requestId → dashboard exec-log responsePayload (quote it to Sarvam support). Note: asrEndpointingSilenceMs only affects Azure — for Sarvam agents the dashboard/admin/builder UIs now disable the control with provider-aware copy (value preserved for switching back). COALESCE_INCOMPLETE_MS default is 220 ms (history 1200→800→220, env-overridable) — don't quote 1.2s as the worst-case hold.

## VAD boundary facts (from Sarvam Fine VAD Tuning docs, Jul 2026)
- `high_vad_sensitivity=true` (we always send it) → end-of-speech = 2 silence frames of 512 samples = **~64ms @16kHz / ~128ms @8kHz telephony** — NOT 500ms/1s. The old "fixed 0.5s VAD" belief is wrong for our config; measured endDetectToFinalMs 56–309ms corroborates.
- Default (`false`) = 18-of-24 frames ≈ 1s+ silence.
- Fine-tune overrides exist as WS query params: `negative_frames_count/window`, `interrupt_min_speech_frames`, `first_turn_min_speech_frames` (8), `start_speech_volume_threshold` (dB floor, useful for noisy lines), `pre_speech_pad_frames` (9).
- Consequence: per-turn perceived latency is dominated by our pacing delay (linearDelayMs) + LLM TTFT, not Sarvam VAD.

## first_turn_min_speech_frames — lost first turns on 8kHz telephony (Aug 2026)
A VAD frame is a fixed **512 samples**, so its duration depends on sample rate: 32ms @16kHz, **64ms @8kHz**. Every frame-count default is therefore worth DOUBLE the wall-clock time on our telephony path (which streams native 8kHz).

`first_turn_min_speech_frames` defaults to **8** and is NOT touched by `high_vad_sensitivity`. At 8kHz that demands **512ms of continuous speech** before the first speech segment of a connection will open. Short first replies ("Yes", "Okay", "Members", "ஆமா" — typically 200–400ms) never open a segment: no `speech_start`, no transcript, turn lost entirely upstream of every orchestration guard. Symptom looks like "STT completely missed the turn" and is NOT caused by transcriptQuality filters.

"First turn" resets **per connection**, so every reconnect (backoff, zombie-WS terminate) and every live `setLanguage()` switch re-arms the 512ms gate mid-call.

Fix: `buildWsUrl()` now sends a sample-rate-compensated value — **4 frames @8kHz, 8 @16kHz** — holding Sarvam's intended ~256ms window on both paths. Don't "simplify" this back to a constant.

Related: `pre_speech_pad_frames` (9) is also doubled at 8kHz (~576ms of pre-roll), but that only pads a segment that already opened — harmless, not a fix for the above.

## Stuck-open VAD segments — the real dead-air cause (call 5490, Aug 2026)
Sarvam emits a transcript **only at end-of-speech** (no partials). So if its VAD opens a segment and never closes it, that audio is never transcribed — the turn is gone. Call 5490 hit this twice in ~60s, producing **15.3s and 14.7s of dead air**; in the second window the caller spoke three times and only the third utterance reached the LLM.

Signature in the exec log: `VAD Speech Start` with no matching `VAD Speech End` and no transcript, followed ~6s later by `Lost-Turn Force Flush`.

Recovery today is destructive and partly missing:
- The zombie detector (`WS_DEAD_MS` 3s mid-segment) terminates the socket to force a reconnect, which **discards the in-flight utterance** — Sarvam never transcribes it.
- `onConnectionDead` had NO consumer anywhere in the codebase (the old note claiming webcall.ts handled it → batch STT was wrong). It is now wired in `wireStreamSttCallbacks` to log a `Connection Dead` exec row, so the kill is at least visible. **There is still no batch-STT recovery** — the streaming path returns before `audioBuffer.push()`, so no local audio is retained to re-transcribe.
- Each zombie reconnect also re-arms `first_turn_min_speech_frames` on the fresh socket (see above).

Not yet attempted: `start_speech_volume_threshold` (dB floor) to stop line noise holding a segment open — the most likely true fix, needs live tuning.

## Lost-turn recovery via batch STT (call 5490 dead zones)
When Sarvam opens a VAD segment and never closes it, no transcript is ever emitted — Sarvam only produces text at end-of-speech — so the caller's words are gone and the line sits dead until the 10s stall reprompt. `flush()` cannot help: it only drains a fragment the adapter is already holding, and in this failure there is nothing to drain.

The pipeline now keeps a rolling `RECOVERY_MAX_AUDIO_MS` (20s) window of **caller-only** audio (capture pauses during playback and the echo grace, so agent TTS echo can never be recovered and answered). When the lost-turn backstop fires, `attemptLostTurnRecovery()` replays that buffer through the batch endpoint and feeds any text back in as a `force_finalized` turn.

Safety properties, all of which matter:
- **Never fires mid-utterance.** Requires `RECOVERY_MIN_SILENCE_MS` (700ms) of local energy-VAD silence first, so a caller who is still talking is never cut off.
- **Never gates the streaming feed.** It buffers a *copy* of the frames; the DO-NOT-GATE invariant is intact.
- **Duplicate suppression.** The socket re-queues buffered audio across a reconnect, so the same utterance can arrive as a streaming final afterwards. `isNearDuplicateUtterance()` drops it within `RECOVERY_DEDUP_MS` (10s). One-word replies dedupe only on an exact match — processing a stray "yes" twice mid-booking is worse than reprompting.
- **Kill switch:** `STT_LOST_TURN_RECOVERY=0` disables it without a redeploy.

Still unverified against a live call — the trigger only occurs during a real Sarvam stall. Watch for `stt_lost_turn_recovered` in the exec log; if duplicate turns appear, set the env var to 0 and re-tune the dedup window.

## Email normalizer was corrupting ordinary speech (call 5490)
`normalizeSpokenEmail` (transcriptQuality.ts) runs on EVERY transcript via `normalizeSttPhonetics`. Its trigger included a bare `\bat\b`, so any sentence containing "at" entered email mode: "at" became "@", then an unbounded username join stripped the spaces from everything before it.

Real damage seen on live transcripts:
- `"I want to book an appointment tomorrow at 11:00 AM."` → `"Iwanttobookanappointmenttomorrow@11:00 AM."`
- `"Call me at 5 in the evening"` → `"Callme@5 in the evening"`
- `"my email is karthik@gmail.com"` → `"myemailiskarthik@gmail.com"`

For a booking agent ("book at 11", "meet at 3") this hit a large share of turns. Fixed by (a) requiring an explicit address marker or a mail-domain token before entering email mode — a bare "at"/"dot" no longer qualifies, (b) converting bare "at" → "@" only when a domain token is present, (c) bounding the username join: letter-by-letter dictation joins freely, whole words join at most `MAX_USERNAME_WORDS` (2), and it stops at carrier words ("my", "email", "is", "to", …). Covered by `spoken-email.test.ts`; the legacy dictation cases in `transcriptQuality.test.ts` still pass unchanged.

Known limitation (pre-existing, untouched): a fully letter-by-letter DOMAIN (`"@g m a i l . c o m"`) is only partly merged, because that regex's character class excludes whitespace.

## Do not drop a noise stub from a long utterance (call 5490)
`isUltraShortNoiseFragment` judges TEXT only. In call 5490 a **1.36s** utterance transcribed as `"Hmm"` and was silently discarded, so the agent said nothing at all. `processTurn` now compares the transcript against the measured VAD segment (`_lastVadSegmentMs`): below `SUBSTANTIVE_SPEECH_MS` (700ms) it is still dropped as noise, at or above it the caller is asked to repeat via `respondWithClarification`. Logged as `Utterance Misheard` / `stt_misheard`.
