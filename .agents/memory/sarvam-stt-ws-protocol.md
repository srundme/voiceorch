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
- **SUPERSEDED — see the two sections below.** The original design (`lastMsgAt` + `inSpeechSegment`,
  300ms interval, >3s silence during speech) was removed in Aug 2026 because it destroyed any
  utterance longer than three seconds.
- Fires `sttObj.onConnectionDead?.()` → webcall.ts hook → immediate `process()` (batch STT fallback);
  on the telephony path it now also schedules lost-turn recovery.
- StreamSTT interface has `onConnectionDead?: (() => void) | null` — set by caller after creation.
- Heartbeat interval cleared in `close()` to prevent leaks.

## INBOUND SILENCE IS NOT EVIDENCE OF ANYTHING (calls 5498/5499, Aug 2026)
The single most important fact about this protocol. Sarvam sends nothing between turns (no speech)
and **nothing during an utterance** — transcripts arrive only at end-of-speech. A quiet socket is
the normal case, so "no inbound frame for N seconds" can never, on its own, mean the socket is dead.
- The old detector terminated the socket after 3s of inbound silence **inside an open speech
  segment** — i.e. exactly when Sarvam is legitimately quiet. That put a hard ~3s ceiling on how
  long a caller was allowed to speak. Every utterance past ~3.1s was guillotined mid-sentence and
  its audio destroyed. Across calls 5498/5499: kills at 3230ms, 3186ms and 3050ms after
  speech_start, longest survivor 3078ms (and only because speech_end beat the 300ms heartbeat
  tick). Nothing above 3.1s ever completed. ~20% of turns. **This was the real cause of the
  long-standing "STT randomly misses a turn" reports.** Do not reinstate it in any form.
- The three checks that replaced it, all in `sarvam.ts`, are keyed on something that is actually
  evidence: `isTranscriptOverdue` (speech_end landed, so text is owed and its absence is a fault),
  `isRecognitionStalled` (repeated speech_start with no transcript), and WebSocket ping/pong.
- **Only speech_end may arm an inbound-silence timer.** speech_start must never arm one.
- The ping/pong check SELF-CALIBRATES: it enforces only after seeing at least one pong on that
  socket, so if Sarvam ever stops answering pings we degrade to not enforcing rather than killing
  every connection. Keep that property if you touch it.

## Detecting a lost turn is useless unless the audio is recovered (calls 5498/5499)
`onConnectionDead` fires at the one moment we know an utterance was destroyed, and the caller's
audio is still in the recovery ring buffer. It used to only write a log line reading "Any audio
still in flight is lost" — the recovery was never wired to it.
- The 6s flush backstop cannot cover this case and never fired once across three dead-socket
  episodes: speech_start arms it for T+6s, the socket dies at ~T+3.1s, the **reconnect's own**
  speech_start at ~T+4.2s re-arms it, and the speech_end 100ms later clears it outright.
- Recovery cannot run the instant the socket dies (the caller is usually mid-sentence, and
  `attemptLostTurnRecovery` rightly refuses a partial utterance) and a single deferred attempt is
  equally wrong. `scheduleLostTurnRecovery()` polls for caller silence, bounded by a deadline.
- A reconnect emits a garbage stub ("ஆ.", "ஏ", 8–86ms segments) about a second after the kill.
  Releasing recovery state on transcript ARRIVAL let that stub wipe the buffer holding the real
  utterance. Release it only after a transcript survives the quality guards — i.e. at the
  accepted-turn point in `handleStreamingTranscript`, next to `safetyNet.onFinal()`.

## The heartbeat only proves the SOCKET is alive, not the ENGINE (call 5439, Aug 2026)
- Every inbound frame refreshes `lastMsgAt`, and VAD signals are inbound frames. Sarvam can keep
  emitting `speech_start` while its recognition engine produces no transcripts at all — inbound
  traffic never stops, so the >3s silence check can never fire. Call 5439 died exactly there:
  three `speech_start` events over ~8s, zero transcripts, no termination, then three silence
  reprompts and a `silence_timeout` hangup. The safety net was neutralised by the events it existed
  to see through.
- **Do NOT "fix" this with a plain no-transcript timeout.** Sarvam emits transcripts only at
  end-of-speech, so a caller talking continuously for 10s is indistinguishable from a stalled
  engine. That check terminates healthy sockets mid-sentence — worse than the bug.
- The signature that actually discriminates: **repeated `speech_start` with no transcript in
  between**. A healthy utterance of any length is one `speech_start` → `speech_end` → transcript.
  Two `speech_start`s with nothing between them means the engine restarted its VAD without
  recognising anything. `isRecognitionStalled()` in `sarvam.ts` requires both ≥2 such segments and
  >3s elapsed, and it times from the FIRST silent `speech_start` — timing from the latest is the
  same self-resetting-window bug in a new place.
- `deadFired` is cleared only by a transcript or a fresh socket, never by a VAD signal.
- Anything that clears stall state must ALSO run on `ws.on("open")`. Counters that justified
  killing a socket stay armed against its replacement otherwise, and the heartbeat kills every new
  socket on sight — a reconnect loop.
- `flush()` returns whether it emitted. It can only drain a buffer the adapter already holds, so it
  is a silent no-op precisely when the engine produced nothing — the case the lost-turn backstop
  cares about. Two consecutive empty flushes force a reconnect; the pipeline skips batch recovery
  when the flush did emit, so the two paths cannot race into a near-duplicate turn.

## Utterances table (June 2026)
- `lib/db/src/schema/utterances.ts` — one row per user turn; call_id FK, coalesced bool,
  mergedSegments, pauseCount, provider, latencyMs.
- Insert is fire-and-forget in `process()` right after `safetyNet.onFinal()`.
- Enables future analytics: avg pause per language, interruption rate, Tamil/English ratio.

**Two-VAD question (investigated, no race):** the pipeline feeds ALL caller frames to the Sarvam WS unconditionally on the streaming path — client energy VAD only drives barge-in/watchdog/safety-net, never gates the feed, never calls flush(), never finalizes turns; Sarvam server VAD (high_vad_sensitivity=0.5s + vad_signals) owns end-of-speech. Input-level gating existed once and was removed (calls 772→1320: gating starved Sarvam → barge-in impossible) — beware STALE comments claiming frames are gated during playback. Docs-recommended 60s-idle keep-alive already implemented (heartbeat tick, 15s idle → 200ms silence frame, outside speech segments). Turn-taking latency is a legitimate STACK, not a race: 0.5s server VAD + 30ms fast-flush (or 120-1200ms coalesce holds when final looks incomplete) + ≤300ms startSpeakingPlan cap. request_id from every WS response now captured → transcript/error logs + SttFinalMetadata.requestId → dashboard exec-log responsePayload (quote it to Sarvam support). Note: asrEndpointingSilenceMs only affects Azure — for Sarvam agents the dashboard/admin/builder UIs now disable the control with provider-aware copy (value preserved for switching back). COALESCE_INCOMPLETE_MS comes from the agent's `sarvamIncompleteHoldMs`, whose platform default is **700 ms** (`SARVAM_STT_LATENCY_DEFAULTS`; history 1200→800→220→700, env-overridable via SARVAM_COALESCE_INCOMPLETE_MS). The bare 350 ms in the adapter is only the no-config fallback. Stale "default 220" comments were removed from sarvam.ts in Aug 2026 — don't reintroduce them, and don't quote 1.2s as the worst-case hold.

## VAD boundary facts (from Sarvam Fine VAD Tuning docs, Jul 2026)
- `high_vad_sensitivity=true` (we always send it) → end-of-speech = 2 silence frames of 512 samples = **~64ms @16kHz / ~128ms @8kHz telephony** — NOT 500ms/1s. The old "fixed 0.5s VAD" belief is wrong for our config; measured endDetectToFinalMs 56–309ms corroborates.
- Default (`false`) = 18-of-24 frames ≈ 1s+ silence.
- Fine-tune overrides exist as WS query params: `negative_frames_count/window`, `interrupt_min_speech_frames`, `first_turn_min_speech_frames` (8), `start_speech_volume_threshold` (dB floor, useful for noisy lines), `pre_speech_pad_frames` (9).
- Consequence: per-turn perceived latency is dominated by our pacing delay (linearDelayMs) + LLM TTFT, not Sarvam VAD.

## Configure VAD in MILLISECONDS, never in frames (Aug 2026)
Every Sarvam VAD parameter is a count of frames, and a frame is a fixed **512 samples** — 32ms @16kHz but **64ms @8kHz**. So any frame count hardcoded in our source means twice as long on telephony as the docs imply. That is not theoretical: it is the whole cause of the lost-first-turn bug below.

The adapter therefore stores these settings as wall-clock ms and converts at connect time against the live sample rate:
- `msToVadFrames(ms, sampleRate)` — the single conversion point.
- `first_turn_min_speech_frames` ← `firstTurnMinSpeechMs` (default `DEFAULT_FIRST_TURN_MIN_SPEECH_MS` = 256ms, i.e. Sarvam's intent read at 16kHz).
- `negative_frames_count` / `negative_frames_window` ← `endOfSpeechSilenceMs` via `endOfSpeechFrames()`, which mirrors Sarvam's own 18-of-24 tolerance ratio so a stray blip late in the pause does not reset the countdown.

Resolution order for each, via `resolveMsSetting` / `resolveOptionalMsSetting`: **per-agent config → env override → documented default**, always clamped so a bad value cannot disable VAD. Per-agent keys are `sarvamFirstTurnMinSpeechMs` and `sarvamEndOfSpeechSilenceMs`; env keys are `SARVAM_FIRST_TURN_MIN_SPEECH_MS` and `SARVAM_END_OF_SPEECH_SILENCE_MS`. Agent config carries `null` for an unset field, so null must fall through to env rather than short-circuit.

Frames are indivisible, so a requested window is met to the nearest frame (at worst 32ms out at 8kHz). Windows that are multiples of 64ms land exactly on both paths. Covered by `sarvam-vad-frames.test.ts`.

## high_vad_sensitivity is a two-position switch, and on telephony both positions are bad
- ON  = 2 silence frames = **~128ms @8kHz**. Cuts callers mid-utterance on PSTN (call 4940), which is why the platform default was set to OFF.
- OFF = 18-of-24 frames = **~1150–1550ms @8kHz**. Over a second of dead air on *every* turn, since Sarvam emits a transcript only at end-of-speech.

`SARVAM_STT_LATENCY_DEFAULTS.highVadSensitivity` is `false`, so production agents are on the slow end of that switch. Setting `endOfSpeechSilenceMs` sends the underlying frame counts explicitly and unlocks the whole range in between (e.g. 400ms) instead of choosing between two extremes. Left unset by default so behaviour is unchanged until someone opts in.

**Verify before enabling:** `SARVAM_API_KEY=... pnpm tsx src/scripts/probe-sarvam-vad.ts speech.wav` measures the real boundary per setting and proves Sarvam accepts the params rather than rejecting the socket. The probe imports the same helpers the adapter uses, so a pass is evidence about production.

## first_turn_min_speech_frames — lost first turns on 8kHz telephony (Aug 2026)
A VAD frame is a fixed **512 samples**, so its duration depends on sample rate: 32ms @16kHz, **64ms @8kHz**. Every frame-count default is therefore worth DOUBLE the wall-clock time on our telephony path (which streams native 8kHz).

`first_turn_min_speech_frames` defaults to **8** and is NOT touched by `high_vad_sensitivity`. At 8kHz that demands **512ms of continuous speech** before the first speech segment of a connection will open. Short first replies ("Yes", "Okay", "Members", "ஆமா" — typically 200–400ms) never open a segment: no `speech_start`, no transcript, turn lost entirely upstream of every orchestration guard. Symptom looks like "STT completely missed the turn" and is NOT caused by transcriptQuality filters.

"First turn" resets **per connection**, so every reconnect (backoff, zombie-WS terminate) and every live `setLanguage()` switch re-arms the 512ms gate mid-call.

Fix: `buildWsUrl()` derives the frame count from a millisecond window at the live sample rate — **4 frames @8kHz, 8 @16kHz** for the 256ms default. Don't "simplify" this back to a frame constant; that is the bug, not the fix.

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

All of its timings are resolved per-call in `stt-tuning.ts` rather than fixed in the pipeline: `recoveryMinSilenceMs` is **twice the agent's own longest turn-closing silence** (so a patiently-tuned agent gets a patient recovery, with a 400ms floor), `recoveryMaxAudioMs` is twice the stall-reprompt window, and `recoveryDedupMs` is twice the backstop. Each also takes an env override (`STT_RECOVERY_*`, `STT_LOST_TURN_BACKSTOP_MS`) for tuning a live call without a redeploy. With platform defaults these derive to exactly the previous fixed values.

The pipeline keeps a rolling `recoveryMaxAudioMs` (20s at defaults) window of **caller-only** audio (capture pauses during playback and the echo grace, so agent TTS echo can never be recovered and answered). When the lost-turn backstop fires, `attemptLostTurnRecovery()` replays that buffer through the batch endpoint and feeds any text back in as a `force_finalized` turn.

Safety properties, all of which matter:
- **Never fires mid-utterance.** Requires `recoveryMinSilenceMs` (700ms at defaults) of local energy-VAD silence first, so a caller who is still talking is never cut off.
- **Never gates the streaming feed.** It buffers a *copy* of the frames; the DO-NOT-GATE invariant is intact.
- **Duplicate suppression.** The socket re-queues buffered audio across a reconnect, so the same utterance can arrive as a streaming final afterwards. `isNearDuplicateUtterance()` drops it within `recoveryDedupMs` (12s at defaults). One-word replies dedupe only on an exact match — processing a stray "yes" twice mid-booking is worse than reprompting.
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
`isUltraShortNoiseFragment` judges TEXT only. In call 5490 a **1.36s** utterance transcribed as `"Hmm"` and was silently discarded, so the agent said nothing at all. `processTurn` now compares the transcript against the measured VAD segment (`_lastVadSegmentMs`): below `substantiveSpeechMs` (700ms, `STT_SUBSTANTIVE_SPEECH_MS`) it is still dropped as noise, at or above it the caller is asked to repeat via `respondWithClarification`. Logged as `Utterance Misheard` / `stt_misheard`.
