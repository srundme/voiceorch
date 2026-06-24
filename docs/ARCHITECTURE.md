# VoiceOrch Call-Orchestration Architecture

> **Audience:** new engineers joining the VoiceOrch call-orchestration team.
> **Scope:** the real-time voice pipeline that powers a live call from first audio
> frame to final billing — for **both** call paths (PSTN/telephony and browser web
> call).
> **Status:** permanent engineering reference. Every file, function, constant, and
> table named below was verified against the source at the time of writing. When the
> code and this document disagree, **trust the code** and update this document.

The single most important thing to understand before touching anything: **there are
two largely-parallel implementations of the same call loop** —
`orchestration/pipeline.ts` (telephony) and `orchestration/telephony/webcall.ts`
(web). They share *support* modules but **not** the core turn loop. A feature added
to one is **not** automatically present in the other. Section 2 (Feature Ownership)
and the duplication callouts throughout exist specifically to keep you from shipping
a fix to only half the product.

All paths below are relative to the repository root unless noted. The orchestration
code lives under `artifacts/api-server/src/`.

---

## 1. Overall Architecture — call lifecycle for both paths

VoiceOrch is the orchestration layer of an AI voice-agent SaaS. It does **not** own
the ASR/LLM/TTS/telephony models; it streams audio between a caller and a chain of
provider adapters and manages turn-taking, barge-in, memory, tools, recording, and
billing.

### 1.1 The two entry points

| Path | Transport | Entry point | Core turn loop lives in |
| :--- | :--- | :--- | :--- |
| **Telephony (PSTN)** | Provider media WebSocket (Twilio/Plivo/Vobiz) | WS handlers in `orchestration/telephony/{twilio,plivo,vobiz}.ts` → `createSession()` in `orchestration/session.ts` | **class `OrchestrationPipeline`** in `orchestration/pipeline.ts` |
| **Web call** | Browser ↔ server WebSocket | `handleWebCallWebSocket()` in `orchestration/telephony/webcall.ts` | **one large closure** inside `handleWebCallWebSocket` (nested functions, *not* a class) |

This structural asymmetry is the root cause of all the duplication: telephony is an
object with private methods and instance fields; web call is a function with closure
locals. The same concept (e.g. "echo grace") is therefore an instance field
(`bargeInHoldUntil`) in one and a closure `let` (`echoGraceUntil`) in the other.

### 1.2 Telephony lifecycle (live PSTN call)

1. **WS connect & `start`** — the provider handler (`twilio.ts` / `plivo.ts` /
   `vobiz.ts`) receives the provider's `start` frame and calls
   `createSession()` (`session.ts`).
2. **`createSession()` setup** (`session.ts`):
   - Resolves provider keys (BYOP) or **managed fallback keys** from
     `platform_settings` (e.g. `managed_openai_key`).
   - Reuses an existing `in_progress` row keyed by `externalCallId`, or inserts a new
     `calls` row with `status: "in_progress"`.
   - Writes the "Call Started" event via `writeCallStartedLog()` to
     `execution_logs`.
   - Instantiates `new OrchestrationPipeline(config)` with STT/LLM/TTS adapters.
   - Registers the session in the module-level `sessions = new Map<string, ActiveSession>()`.
3. **`OrchestrationPipeline` constructor** (`pipeline.ts`):
   - Creates `recording = new RecordingBuffer(8000)` (**8 kHz** — note the divergence
     from web call), `safetyNet = new TurnSafetyNet(...)`, a gender detector, and the
     provider adapters.
   - Reads barge-in parameters **from `agentConfig`**: `vadSilenceMs`,
     `bargeInEnergyThreshold`, `bargeInMinFrames`, `bargeInEchoGraceMs`. If a
     `stopSpeakingPlan` is configured it overrides `bargeInMinFrames`
     (`numWords × 20` or `voiceSeconds × 50`) and `bargeInEchoGraceMs`
     (`backOffSeconds × 1000`).
   - If ambient noise is enabled, starts an `ambientInterval` (~20 ms) that emits
     `ambientStream.nextMulawChunk()` via `config.onAudioOut` while not speaking.
   - Calls `initStreamingSTT()` if the STT adapter supports streaming.
4. **Greeting** — `greet()`:
   - If `agent.firstSpeaker === "user"`, returns immediately (agent stays silent).
   - If `ivrEnabled` + `ivrGreeting`, runs `runIvr()`.
   - Otherwise resolves `agent.greetingMessage` (supports `{{caller_salutation}}`
     from the gender detector) and speaks it via `speakRaw()` → `_playSentenceImpl()`.
   - If the greeting message is blank, pushes a system instruction and calls
     `processTurn("", 0)` so the LLM generates a dynamic opener.
5. **Inbound audio** — `onAudioIn(mulawChunk)` feeds the audio pool; the decoded
   result arrives at `handleProcessedAudio({ pcm8k, pcm16k, hasSpeech })`:
   - VAD via `hasSpeechEnergy(pcm8k, this.bargeInEnergyThreshold)`.
   - **Barge-in:** while `isPlaying`, accumulates `bargeInSpeechFrames`, suppressed
     while `now < this.bargeInHoldUntil` (echo grace). Once frames ≥ effective min,
     sets `bargeInRequested`, fires the barge-in callback, and captures caller audio.
   - **Silence flush:** after `vadSilenceMs` of no speech, `scheduleSilenceFlush()` →
     `flushAndProcess()` → `processTurn()`.
6. **Streaming STT** — `handleStreamingTranscript()` drives `safetyNet.onPartial()`
   on partials and calls `processTurn()` on final; also handles
   semantic/word-count barge-in (`isSemanticInterrupt`, `streamingBargeInWordCount`).
7. **Turn processing** — `processTurn(transcript, sttLatencyMs)`:
   - Increments `turnIndex` / `_activeTurnIndex`, resets barge-in counters.
   - Runs `checkTranscriptQuality()` (garbled-input guard) and
     `checkGuardrailRoutes()` (fast canned responses).
   - Races KB retrieval against `KB_CONTEXT_RACE_MS` (200 ms).
   - Streams the LLM via `llm.generateStream`, piping tokens through
     `makeThinkFilter`, `makeFunctionTagFilter`, `makeMarkupTagFilter`,
     `makeBracketFilter`.
   - Extracts speakable units with **`extractSentences(text): { sentences, remainder }`**
     and enqueues each onto the playback loop (`playTask`).
   - If the first LLM token is slow (`FILLER_THRESHOLD_MS`, 800 ms) and
     backchanneling is on, plays a filler from `backchannel.ts`.
8. **Tools** — `handleToolCall()` → `handleToolCallInner()` dispatches to
   `executeWebhookTool`, `executeSendSms`, `executeEndCall`, `executeCalCom`,
   `executeCallTransfer`, `executeTransfer{Cold,Warm,Agent}`, and the native
   scheduling wrappers (`executeNativeBooking`, `executeNativeReschedule`,
   `executeNativeCancel`, `executeNativeCheckAvailability`,
   `executeNativeListBookings`). Tool output is fed back through
   `continueWithToolResult()`.
9. **TTS playback** — `playSentence()` → `_playSentenceImpl()` synthesizes via
   `tts.synthesizeStream`/`tts.synthesize`, downsamples 16 k → 8 k, μ-law-encodes,
   and emits via `config.onAudioOut`. `addAgentChunk()` records the audio. At the end
   of the playback loop `drainPlaybackTail()` emits `TELEPHONY_TAIL_DRAIN_MS` (800 ms)
   of silence so the carrier jitter buffer does not clip the final words;
   `armTailEchoGrace()` re-arms echo grace.
10. **Teardown** — `close()` sets `closed`, clears `ambientInterval`, DTMF timers,
    `silenceTimer`, `silenceHangupTimer`, `streamSTTReconnectTimer`, then
    `safetyNet.clear()` and `streamSTT.close()`.
11. **Finalization** — **`endSession()` in `session.ts`** does the heavy lifting
    (call-record finalize, usage, billing, disposition, memory). See §1.4.

### 1.3 Web-call lifecycle (browser)

Everything below is inside the single `handleWebCallWebSocket(ws, ...)` closure in
`webcall.ts`:

1. **Auth/gating & setup:**
   - Loads the agent (`agents`), provider rows (`providers`, keys via `decryptKey`),
     and **managed fallback keys** from `platform_settings`.
   - **Balance gate:** rejects if `users.walletBalanceCents <= 0`.
   - **Concurrency gate:** rejects if the per-user count in the `activeCalls` map
     reaches `users.concurrentLimit` (default `DEFAULT_CONCURRENT_LIMIT = 15`).
   - Inserts a `calls` row with `toNumber: "webcall"`, `fromNumber: "browser"`,
     `status: "in_progress"`.
2. **Greeting** — `greet()`: resolves/generates greeting, strips `<think>` and markup,
   synthesizes, and emits via `sendSpeechAudio()`; arms `echoGraceUntil` and drains a
   300 ms tail.
3. **Inbound audio** — `ws.on("message")` receives **PCM16 @ 16 kHz** frames
   (~`WEBCALL_FRAME_MS = 128` ms each from a browser `ScriptProcessorNode(2048)`):
   - Energy via `rmsEnergy(data)`.
   - **Normal VAD:** agent silent + energy > `SPEECH_RMS_THRESHOLD` (400) →
     `scheduleSilenceFlush()`.
   - **Barge-in:** agent speaking + energy > `BARGE_IN_RMS` (800), suppressed while
     `Date.now() < echoGraceUntil`; needs `bargeInFrames ≥ BARGE_IN_MIN_FRAMES` (3)
     and duration > `BARGE_IN_MIN_DURATION_MS` (150 ms); sets `interrupted`, sends
     `{ type: "interrupted" }`, triggers `process()`.
   - `recording.addCallerChunk(data)`.
4. **Streaming STT** — `stt.transcribeStream` handler: `onPartial` feeds
   `safetyNet.onPartial`; `onFinal` checks `isSemanticInterrupt` and either
   interrupts or sets `streamingTranscriptPending` and calls `process()`.
5. **Turn processing** — `async function process()`: clears timers, sets "thinking",
   obtains transcript, runs `checkTranscriptQuality`, then streams the LLM
   (`llm.chatStream`), filtering think/function/markup/bracket tokens inline.
6. **Sentence extraction** — **`extractSentences(buf, minCommaChars = 15): [string[], string]`**
   — a **tuple** `[sentences, remainder]`, a *different shape* from pipeline.ts (see
   §1.5). Each sentence is synthesized as it is produced.
7. **Tools** — a `while (triggeredToolName)` loop, capped at
   `MAX_TOOL_ITERATIONS = 5`. Native scheduling tools run; **`call_transfer` and
   `send_sms` are skipped as no-ops** on the web path.
8. **TTS send** — `sendSpeechAudio(pcm16k)`: `amplifyPcm(pcm16k, TTS_VOLUME_GAIN=1.5)`
   → `ambientStream.mixIntoPcm16k` → `sendAudio` (raw PCM to the WS), updating
   `lastChunkSentAt`. `withTailSilence` appends `TTS_TAIL_SILENCE_MS` (150 ms);
   the loop also drains `AUDIO_TAIL_SILENCE_MS` (300 ms) and holds echo grace an extra
   `WEB_TAIL_ECHO_MARGIN_MS` (800 ms) past the drain.
9. **Recording** — `recording = new RecordingBuffer(16000)` (**16 kHz** — diverges
   from telephony's 8 kHz); `addAgentChunk` from the send loop.
10. **End** — **`hangup(reason, errorDetail)`** does its **own** inline finalization
    (it does **not** call `endSession()`): finalize recording → `writeCallEndedLog` →
    update `calls` → update `agents` → `recordUsage` (STT/LLM/TTS) → billing
    (`resolveAgentBillingMode`, deduct `users.walletBalanceCents`, insert
    `wallet_transactions`) → fire-and-forget summary/disposition/memory →
    `{ type: "ended" }` and close.

### 1.4 Telephony finalization — `endSession()` (`session.ts`)

Order (verified):

1. Remove session from the `sessions` map; `removeSession()` (session store).
2. Tear down pipeline (`close()`) and audio worker; destroy the audio-pool session.
3. Finalize the `calls` row: `endedAt`, `durationSeconds`, final `transcript`,
   latency metrics (`avgSttMs`, `avgLlmMs`, …).
4. Fire-and-forget regulatory scans: `scanForOptOut` (TRAI) and `scanAndRedactPII`
   (DPDP).
5. `recordUsage()` — separate `usage_events` rows for `stt`, `llm`, `tts`.
6. Update `agents` rolling averages and counts.
7. **Billing:** `resolveAgentBillingMode()` → compute `debitCents` →
   set `calls.costCents` → deduct `users.walletBalanceCents` → insert
   `wallet_transactions`.
8. `writeCallEndedLog()` → `execution_logs`.
9. Async enrichment: LLM summary, legacy disposition JSON, success-criteria eval,
   then the configured `webhookUrl`.
10. `disposeCall()` — taxonomy disposition.
11. `updateCallerProfile()` — caller-memory archive + fact extraction.

> **CRITICAL DUPLICATION (finalization):** telephony finalizes in
> `session.ts::endSession`; web call finalizes in `webcall.ts::hangup`. These are two
> separate implementations of the *same* responsibilities (recording finalize, usage,
> billing, disposition, memory). **Any change to call finalization must be applied to
> both.**

### 1.5 pipeline.ts ↔ webcall.ts duplication map (read this before editing either)

| Concern | `pipeline.ts` (telephony) | `webcall.ts` (web) | How they differ |
| :--- | :--- | :--- | :--- |
| **Code shape** | `class OrchestrationPipeline` with private methods + instance fields | one closure (`handleWebCallWebSocket`) with nested functions + `let` locals | object vs closure — same logic lives in different scopes |
| **Sentence extraction** | `extractSentences(text): { sentences, remainder }` (**object**, exported) | `extractSentences(buf, minCommaChars=15): [string[], string]` (**tuple**, local) | **Different return shape** — do not copy call sites verbatim between files |
| **Turn entry** | `processTurn(transcript, sttLatencyMs)` | `process()` | different signatures |
| **Recording sample rate** | `RecordingBuffer(8000)` | `RecordingBuffer(16000)` | telephony is 8 kHz, web is 16 kHz |
| **Echo grace state** | instance `bargeInHoldUntil`, `armTailEchoGrace()` | closure `echoGraceUntil`, re-armed per sentence | both re-arm per sentence + at tail; **different variable names** |
| **Barge-in tuning** | from `agentConfig` (`bargeInEnergyThreshold`, `bargeInMinFrames`, `bargeInEchoGraceMs`, `vadSilenceMs`) + `stopSpeakingPlan` overrides | hardcoded module consts (`BARGE_IN_RMS=800`, `BARGE_IN_MIN_FRAMES=3`, `BARGE_IN_ECHO_GRACE_MS=700`, `SPEECH_RMS_THRESHOLD=400`) | **per-agent configurable vs hardcoded** |
| **End-of-turn grace** | `TELEPHONY_TAIL_DRAIN_MS=800` (μ-law silence frames) | `TTS_TAIL_SILENCE_MS=150` + `AUDIO_TAIL_SILENCE_MS=300` + `BARGE_IN_END_GRACE_MS=1200` + `WEB_TAIL_ECHO_MARGIN_MS=800` | different mechanisms for clip/echo prevention |
| **Tool cap** | recursive `continueWithToolResult(depth)` | `while` loop, `MAX_TOOL_ITERATIONS=5` | different control structure |
| **Transfers / SMS** | implemented (`executeCallTransfer`, `executeSendSms`, `executeTransfer{Cold,Warm,Agent}`) | **skipped as no-ops** | web call cannot transfer or send SMS |
| **Finalization** | `session.ts::endSession` | `webcall.ts::hangup` | two implementations (see §1.4) |
| **Token filters** | factory filters from `reasoningFilter.ts` (`makeThinkFilter`) + inline tag/bracket filters | equivalent filtering inline | same intent, different construction |

---

## 2. Feature Ownership

"Owner" = the file you edit to change the behavior. **(both)** means the feature is
duplicated across `pipeline.ts` and `webcall.ts` and must be changed in both.

| Feature | Owner(s) |
| :--- | :--- |
| Telephony turn loop | `orchestration/pipeline.ts` |
| Web-call turn loop | `orchestration/telephony/webcall.ts` |
| Session create/finalize (telephony) | `orchestration/session.ts` |
| Provider media WS handlers | `orchestration/telephony/{twilio,plivo,vobiz}.ts` |
| Outbound dialing | `orchestration/telephony/dial.ts` |
| Live call transfer | `orchestration/telephony/transfer.ts` + `services/tool-executor.ts` |
| STT provider abstraction | `orchestration/adapters/stt/` (`index.ts` + per-provider) |
| LLM provider abstraction | `orchestration/adapters/llm/` |
| TTS provider abstraction | `orchestration/adapters/tts/` |
| Endpointing / turn safety net | `orchestration/endpointing.ts` (shared) |
| Barge-in detection | **(both)** — pipeline `handleProcessedAudio`; webcall `ws.on("message")` |
| Sentence streaming | **(both)** — `extractSentences` (different shapes) |
| Token / reasoning filtering | `orchestration/reasoningFilter.ts` + inline filters in **(both)** |
| Conversation discipline (one-step turns) | `orchestration/conversationDiscipline.ts` (shared) |
| Transcript quality / semantic interrupt | `orchestration/transcriptQuality.ts` (shared) |
| Backchannel fillers | `orchestration/backchannel.ts` (shared) |
| Caller memory (L0/L1/L2) | `orchestration/callerMemory.ts` (shared) |
| Knowledge-base retrieval | `orchestration/kb-retrieval.ts` (shared) |
| Datetime injection | `orchestration/datetimeInject.ts` (shared) |
| DTMF detection | `orchestration/dtmf.ts` — **(both)** |
| Audio DSP (μ-law, resample, energy, noise) | `orchestration/audio.ts` (shared) |
| Audio worker pool | `orchestration/audioPool.ts` + `audioWorker.ts` |
| Ambient background noise | `orchestration/ambient.ts` — **(both)** |
| Voice/gender detection | `orchestration/genderDetector*.ts`, `silero-vad.ts` |
| Recording (stereo WAV → Postgres) | `orchestration/recorder.ts` (shared, different sample rate per path) |
| Tool definitions & native tools | `services/tool-executor.ts` |
| Disposition (taxonomy) | `services/disposition.ts`, `services/disposition-llm.ts` |
| Usage recording / pricing | `services/usage/record-usage.ts` |
| Usage spike alerts | `services/usage/alert-engine.ts`, `services/spike-*.ts` |
| Billing rate resolution | `services/minute-rates.ts` |
| Execution / activity logging | `services/execution-log.ts` |
| Campaign (outbound) calling | `orchestration/campaignCaller.ts`, `services/batchScheduler.ts` |
| Callback scheduling | `orchestration/callbackScheduler.ts`, `services/callbackDetector.ts` |
| TRAI compliance | `services/trai/` |
| DPDP (PII) compliance | `services/dpdp/`, `services/dpdpRetention.ts` |
| Shared HTTP keep-alive pool | `orchestration/http/pool.ts` (process-wide) |
| DB retry wrapper | `orchestration/db-retry.ts` |
| Session store (metadata) | `orchestration/sessionStore.ts` |

---

## 3. Dependency Map

```
Telephony provider WS (twilio.ts / plivo.ts / vobiz.ts)
        │  start frame
        ▼
session.ts::createSession ──────────────┐
        │ instantiates                   │ finalizes
        ▼                                 ▼
pipeline.ts (OrchestrationPipeline) → session.ts::endSession
        │
        ├── adapters/stt/*   (createSTTAdapter)
        ├── adapters/llm/*   (createLLMAdapter)
        ├── adapters/tts/*   (createTTSAdapter)
        ├── endpointing.ts   (TurnSafetyNet, computeEndpointMs)
        ├── audioPool.ts → audioWorker.ts (audio.ts DSP, NoiseCanceller)
        ├── recorder.ts (RecordingBuffer → call_recordings)
        ├── callerMemory.ts / kb-retrieval.ts / datetimeInject.ts
        ├── conversationDiscipline.ts / transcriptQuality.ts / backchannel.ts
        ├── reasoningFilter.ts / dtmf.ts / ambient.ts
        ├── genderDetector*.ts / silero-vad.ts
        ├── services/tool-executor.ts → telephony/transfer.ts, services/scheduling/*
        └── http/pool.ts (global undici dispatcher — process-wide)

Browser WS
        ▼
webcall.ts::handleWebCallWebSocket (self-contained: setup + loop + hangup)
        └── reuses the same shared modules (adapters, endpointing, recorder,
            callerMemory, kb-retrieval, transcriptQuality, conversationDiscipline,
            backchannel, reasoningFilter, dtmf, ambient, tool-executor) but does
            NOT use session.ts; finalization is inline in hangup().

Finalization fan-out (both paths):
        record-usage.ts → usage_events, provider_pricing
        minute-rates.ts → billing rate
        disposition.ts → call_dispositions, calls.dispositionResult
        callerMemory.ts → caller_profiles / caller_facts / caller_call_archive /
                          caller_sentences / caller_fact_sentence_links
        execution-log.ts → execution_logs
        services/trai/* → trai suppression scan
        services/dpdp/* → PII redaction scan
```

**Key coupling facts**

- `session.ts` depends on `pipeline.ts`; `pipeline.ts` does **not** depend on
  `session.ts` (clean direction). `webcall.ts` is self-contained and bypasses
  `session.ts` entirely.
- `endpointing.ts` (the `TurnSafetyNet` and `computeEndpointMs`) is the **one** turn
  module genuinely shared as-is by both paths.
- `http/pool.ts` is installed once at process startup (`setGlobalDispatcher`) and
  silently affects **every** outbound HTTP call (LLM/TTS/STT REST, telephony REST,
  webhooks, calendar, storage) — WebSocket streaming STT/TTS are unaffected.
- `recorder.ts::RecordingBuffer` is shared but **constructed with a different sample
  rate** per path (8000 telephony / 16000 web).

---

## 4. State Machine

Both paths implement the same conceptual turn FSM, but with different field names.

```
        ┌─────────────┐   greeting done / VAD flush
        │  GREETING   │ ─────────────────────────────┐
        └─────────────┘                               ▼
                                              ┌─────────────┐
        caller speaks (VAD/STT final)         │  LISTENING  │
   ┌───────────────────────────────────────► └─────────────┘
   │                                                 │ transcript ready
   │                                                 ▼
   │                                          ┌─────────────┐  tool call
   │                                          │  THINKING   │ ───────────┐
   │       barge-in (energy/semantic)         │  (LLM gen)  │            ▼
   │   ┌──────────────────────────────┐       └─────────────┘   ┌──────────────┐
   │   │                              ▼              │           │ TOOL_EXEC    │
   │   │                       ┌─────────────┐       │ sentences │ (loop/depth) │
   │   └────────────────────── │  SPEAKING   │ ◄─────┘           └──────────────┘
   │   re-enter listening      │   (TTS)     │   ◄── continueWithToolResult
   │                           └─────────────┘
   │                                  │ playback drained + tail/echo grace
   └──────────────────────────────────┘
                       │ silence/maxDuration/end_call/error
                       ▼
                 ┌─────────────┐
                 │  ENDING     │ → endSession() (telephony) / hangup() (web)
                 └─────────────┘
```

### 4.1 Telephony state (`pipeline.ts` instance fields)

- `isProcessing` — true during LLM/TTS turn work.
- `isPlaying` — true while agent audio is being emitted.
- `bargeInRequested` — set when an interruption is accepted.
- `bargeInSpeechFrames` / `streamingBargeInWordCount` — barge-in accumulators.
- `bargeInHoldUntil` — echo-grace window end (suppresses self-echo barge-in).
- `closed` — lifecycle terminated.
- `turnIndex` / `_activeTurnIndex` — turn sequencing & stale-turn discard.
- Latency probes: `_tTurnVadFlush`, `_tTurnSttFinal`, `_tTurnLlmFirstToken`,
  `_tTurnLlmFirstClause`, `_tTurnTtsFirstByte`, `_tTurnFirstAudioOut`.
- Timers: `silenceTimer` (VAD window, `vadSilenceMs`), `silenceHangupTimer`
  (inactivity hangup), `streamSTTReconnectTimer`, `dtmfTimeoutId`,
  `ambientInterval`.

### 4.2 Web-call state (`webcall.ts` closure locals)

- `closed`, `processing`, `speaking`, `interrupted`.
- `history` (conversation turns), `audioChunks` (batch-STT fallback buffer).
- `lastChunkSentAt` (last outbound audio timestamp), `echoGraceUntil` (echo window),
  `bargeInFrames`, `bargeInLowEnergyFrames`, `streamingTranscriptPending`.
- Timers: `maxTimer` (`agent.maxDuration`), `silenceTimer` (VAD flush window,
  `VAD_SILENCE_MS`), `hangupSilenceTimer` (inactivity hangup), `playbackSilenceTimer`
  (fallback if the client never sends `playback_ended`; `PLAYBACK_ENDED_FALLBACK_MS`
  = 120 000), `streamingFallbackTimer` (batch-STT fallback if the WS stream dies;
  `STREAMING_BATCH_FALLBACK_MS` = 8000), `llmKeepalive` (periodic "thinking" status).

### 4.3 Shared turn-endpointing FSM (`endpointing.ts`)

- `computeEndpointMs()` chooses an end-of-turn silence window by context:
  `ENDPOINT_FAST_MS` (150) for terminal punctuation/affirmations,
  `ENDPOINT_DEFAULT_MS` (150) baseline, `ENDPOINT_LONG_MS` (600) for dangling words,
  `ENDPOINT_DIGIT_MS` (800) and `ENDPOINT_DIGIT_TRAIL_MS` (900) during digit
  collection.
- `TurnSafetyNet` (shared, both paths) guards the "Listening…" hang:
  force-finalize a partial after `FORCE_FINALIZE_MS` (env, default 1800);
  speak a recovery reprompt after `STALL_BACKSTOP_MS` (env, default 10000);
  end the call after `STALL_MAX_REPROMPTS` (env, default 2) reprompts with continued
  silence.

---

## 5. Data Flow (audio encodings & sample rates at each hop)

### 5.1 Telephony ingress/egress

```
Provider media WS
  ├─ Twilio / Plivo : 8 kHz G.711 μ-law (base64 JSON / binary)
  └─ Vobiz          : 8 kHz linear PCM (LE; no byte-swap)
        │ onAudioIn(mulawChunk)
        ▼
audioPool (audioWorker): μ-law decode + NoiseCanceller  →  pcm8k  +  pcm16k(upsampled)
        │                                  │
        │ VAD on pcm8k (hasSpeechEnergy)   └─► STT adapter: 16 kHz 16-bit mono PCM
        ▼
processTurn → LLM (text) → TTS adapter: 16 kHz 16-bit mono PCM
        │
        ▼ downsample16to8 + encodeMulaw (Vobiz: linear PCM, no μ-law)
   onAudioOut → provider WS
        │
   recording: RecordingBuffer(8000) — stereo WAV (L=caller, R=agent)
```

### 5.2 Web-call ingress/egress

```
Browser ScriptProcessorNode(2048) @ 16 kHz  →  PCM16 frames (~128 ms each)
        │ ws message (raw PCM)
        ▼
rmsEnergy VAD (SPEECH_RMS_THRESHOLD / BARGE_IN_RMS)  →  STT adapter: 16 kHz PCM
        ▼
process() → LLM (text) → TTS adapter: 16 kHz 16-bit mono PCM
        ▼ amplifyPcm(×1.5) → ambient mix → withTailSilence(150ms)
   sendAudio (raw PCM16 over WS) → browser
        │
   recording: RecordingBuffer(16000) — stereo WAV
```

### 5.3 Adapter encoding contract

- **STT** (all providers, `adapters/stt/`): consume **16 kHz 16-bit mono PCM**.
  Streaming: Azure (binary + `X-RequestId` per frame), Deepgram (`linear16`), Sarvam
  (base64-in-JSON). Batch-only: AssemblyAI, Cartesia (WAV-wrapped REST).
- **LLM** (`adapters/llm/`): `createLLMAdapter(provider, apiKey, model, baseUrl?)`;
  streaming via `onToken`/`onDone` (+ `onUsage`); `LLMUsage = { inputTokens,
  outputTokens }`. Real token usage exposed by OpenAI, Groq, Anthropic, Google,
  Mistral; others may estimate.
- **TTS** (`adapters/tts/`): output **16 kHz 16-bit mono PCM**. Streaming: Cartesia
  (`pcm_s16le`), Deepgram (`linear16`). Batch: Azure (`raw-16khz-16bit-mono-pcm`),
  ElevenLabs, OpenAI, Sarvam.

> **Encoding invariant:** the internal "tradecurrency" between STT/LLM/TTS is 16 kHz
> PCM. Telephony transcodes to/from 8 kHz μ-law (or 8 kHz PCM for Vobiz) only at the
> provider boundary. Web call is 16 kHz end-to-end and never touches μ-law.

---

## 6. Configuration Map

### 6.1 `pipeline.ts` module constants (telephony)

| Constant | Value | Purpose |
| :--- | :--- | :--- |
| `BARGE_IN_ENERGY_THRESHOLD` | 1200 | default barge-in energy gate (per-agent override via `agentConfig.bargeInEnergyThreshold`) |
| `TELEPHONY_TAIL_DRAIN_MS` | 800 | silence drained after final utterance to avoid carrier clipping |
| `MIN_SPEECH_BYTES` | 3200 | ~200 ms @ 8 kHz; ignore shorter noise bursts |
| `STREAM_ACCUM_BYTES` | 640 | 20 ms @ 16 kHz before forwarding a TTS stream chunk |
| `HANDOFF_SILENCE_MS` | 3000 | sustained silence that may indicate a phone handoff |
| `FILLER_THRESHOLD_MS` | 800 | play a backchannel filler if no LLM first token by this time |
| `TTS_STREAM_TIMEOUT_MS` | 8000 | abort a TTS streaming fetch with no data |
| `KB_CONTEXT_RACE_MS` | 200 | max wait for KB retrieval before proceeding without it |
| `BRACKET_DISCARD_LEN` | 120 | bracket-filter discard length |
| `TOKEN_OPT_CACHE_TTL_MS` | 30 000 | token-optimization flag cache TTL |

Per-agent (from `agentConfig`): `vadSilenceMs`, `bargeInEnabled`,
`bargeInEnergyThreshold`, `bargeInMinFrames`, `bargeInEchoGraceMs`, plus
`stopSpeakingPlan` overrides.

### 6.2 `webcall.ts` module constants (web)

| Constant | Value | Purpose |
| :--- | :--- | :--- |
| `DEFAULT_CONCURRENT_LIMIT` | 15 | per-user concurrency default when user row has none |
| `VAD_SILENCE_MS` | 150 | silence window before sending audio to STT (per-agent tunable) |
| `SPEECH_RMS_THRESHOLD` | 400 | normal VAD (caller speaking, agent silent) |
| `BARGE_IN_RMS` | 800 | energy gate while agent is speaking |
| `BARGE_IN_MIN_FRAMES` | 3 | min frames to accept a barge-in |
| `BARGE_IN_MIN_DURATION_MS` | 150 | min duration to accept a barge-in |
| `BARGE_IN_LOW_RESET` | 5 | low-energy frames (~200 ms) that reset the barge-in run |
| `WEBCALL_FRAME_MS` | 128 | one browser frame (2048 samples @ 16 kHz) |
| `BARGE_IN_ECHO_GRACE_MS` | 700 | suppress barge-in after TTS starts (browser AEC warm-up) |
| `BARGE_IN_END_GRACE_MS` | 1200 | suppress new-turn detection after last TTS chunk |
| `ECHO_DISCARD_OVERLAP_MS` | 1500 | speech within this of agent-end is genuine overlap |
| `AUDIO_TAIL_SILENCE_MS` | 300 | extra wait so client audio buffer drains |
| `WEB_TAIL_ECHO_MARGIN_MS` | 800 | echo grace held past the tail-silence drain |
| `TTS_TAIL_SILENCE_MS` | 150 | PCM silence appended to each TTS buffer (anti-clip) |
| `TTS_VOLUME_GAIN` | 1.5 | PCM amplitude multiplier |
| `PLAYBACK_ENDED_FALLBACK_MS` | 120 000 | fallback if client never sends `playback_ended` |
| `STREAMING_BATCH_FALLBACK_MS` | 8000 | batch-STT fallback if WS stream dies |
| `MAX_TOOL_ITERATIONS` | 5 | per-turn tool-call cap |

> Note the deliberate value differences vs telephony (e.g. echo grace 700 vs
> telephony's agent-default, energy 800 vs 1200) — they exist because browser AEC and
> 16 kHz PCM energy scales differ from carrier μ-law. Do not "unify" them blindly.

### 6.3 `endpointing.ts` constants & env

`ENDPOINT_FAST_MS=150`, `ENDPOINT_DEFAULT_MS=150`, `ENDPOINT_LONG_MS=600`,
`ENDPOINT_DIGIT_MS=800`, `ENDPOINT_DIGIT_TRAIL_MS=900` (exported consts);
`FORCE_FINALIZE_MS` (env, 1800), `STALL_BACKSTOP_MS` (env, 10000),
`STALL_MAX_REPROMPTS` (env, 2).

### 6.4 `recorder.ts`

`GAP_RESYNC_MS=120` (write-gap above which a track re-syncs to wall-clock),
`BYTES_PER_SAMPLE=2`.

### 6.5 Environment variables (selected, runtime-relevant)

- `DATABASE_URL` — Postgres.
- `SESSION_SECRET` — session JWT signing **and** the AES key for provider-key
  encryption.
- `GROQ_API_KEY` — seeds/fallback for the managed Qwen key.
- Turn safety net: `FORCE_FINALIZE_MS`, `STALL_BACKSTOP_MS`, `STALL_MAX_REPROMPTS`.
- HTTP pool (`http/pool.ts`): `HTTP_POOL_KEEPALIVE_TIMEOUT_MS` (30000),
  `HTTP_POOL_KEEPALIVE_MAX_TIMEOUT_MS` (600000), `HTTP_POOL_CONNECTIONS` (128),
  `HTTP_POOL_PIPELINING` (1).
- `APP_DOMAIN` — canonical public-URL base (see `lib/app-domain.ts`; `REPLIT_DOMAINS`
  is a backward-compat fallback).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — OAuth (auth + calendar).
- `GMAIL_USER` / `GMAIL_APP_PASSWORD` — optional scheduling email.

> Managed provider keys (e.g. `managed_openai_key`) are **not** environment
> variables — they live in the `platform_settings` table and are read at call setup.

---

## 7. Database & Persistence

Schema definitions live in `lib/db/src/schema/`. Tables written during the lifecycle
of a call:

| Table | Schema file | Written by | When |
| :--- | :--- | :--- | :--- |
| `calls` | `calls.ts` | `session.ts` / `webcall.ts`; `disposition.ts` | create (in_progress) at start; finalize (duration, transcript, costCents, dispositionResult) at end |
| `call_recordings` | `calls.ts` | `recorder.ts` (`RecordingBuffer.finalize`) | at end — stereo WAV bytes (bytea) in Postgres |
| `execution_logs` | `activity-logs.ts` | `execution-log.ts` (`writeCallStartedLog`, `writeCallEndedLog`, playback/tool events) | start, during, end |
| `usage_events` | `usage-events.ts` | `services/usage/record-usage.ts` | at end — separate rows for stt / llm / tts |
| `users` | `users.ts` | `session.ts` / `webcall.ts` | at end — `walletBalanceCents` deduction; concurrency/balance read at start |
| `wallet_transactions` | `users.ts` | `session.ts` / `webcall.ts` | at end — call debit record |
| `agents` | `agents.ts` | `session.ts` / `webcall.ts` | at end — rolling avg duration/latency + counts |
| `call_dispositions` | `dispositions.ts` | `services/disposition.ts` | at end — taxonomy result |
| `caller_profiles` | `callerProfiles.ts` | `callerMemory.ts` | at end (`updateCallerProfile`) — callCount, lastCalledAt, summary, drop flags |
| `caller_call_archive` | `callerCallArchive.ts` | `callerMemory.ts` | at end — L1 episode (summary, sentiment, duration) |
| `caller_facts` | `callerFacts.ts` | `callerMemory.ts` | mid-call (`latchCallerFact`) + end — L0 facts with supersession |
| `caller_sentences` | `callerSentences.ts` | `callerMemory.ts` | at end — L2 sentence nodes (provenance) |
| `caller_fact_sentence_links` | `callerFactSentenceLinks.ts` | `callerMemory.ts` | at end — L0→L2 provenance edges |
| `caller_episode_fact_links` | `callerEpisodeFactLinks.ts` | `callerMemory.ts` | at end — L1→L0 synthesis edges |
| `scheduled_callbacks` | `scheduledCallbacks.ts` | `callerMemory.ts` (`detectCallbackRequest`) / `callbackScheduler.ts` | when a callback is requested |
| `call_transfers` | `call-transfers.ts` | `pipeline.ts` transfer tools | on transfer (telephony only) |
| `knowledge_entries` / `agent_knowledge_sources` | `knowledge.ts` | read-only at call time (`kb-retrieval.ts`) | read during turns |
| `platform_settings` | `platform-settings.ts` | read-only at setup (managed keys) | start |
| `providers` | `providers.ts` | read-only at setup (BYOP keys) + `minute-rates.ts` (billing-mode resolution) | start / end |
| `provider_pricing` | `provider-pricing.ts` | read-only by `record-usage.ts` | end |
| TRAI suppression | `trai.ts` | `services/trai/*` (`scanForOptOut`) | end (async) |
| DPDP PII logs | `dpdp.ts` | `services/dpdp/*` (`scanAndRedactPII`) | end (async) |

**Persistence notes**

- **Recordings live in Postgres** (`call_recordings.audio` bytea), *not* object
  storage — Replit Object Storage is unavailable in the Railway production
  deployment. Served at `/api/storage/recordings/:callId`.
- **Provider keys** are stored encrypted at rest (AES-256-GCM, key derived from
  `SESSION_SECRET`); only a last-4 hint is shown in the UI.
- **Caller memory** is a Graphiti-style 3-layer graph: L0 facts (with `superseded_by`
  conflict edges), L1 episodes, L2 sentences, joined via the link tables above.

---

## 8. Event Timeline

A representative successful call (either path), in order:

```
T0   WS connect / start frame
T0   createSession (telephony) | gating + calls insert (web)
T0   calls row → status=in_progress
T0   writeCallStartedLog → execution_logs
T0+  adapters constructed (STT/LLM/TTS), RecordingBuffer created
T0+  greet(): TTS greeting (unless firstSpeaker=user) ; echo grace armed
─── per turn ───────────────────────────────────────────────────────────
Tn   inbound audio frames → VAD energy
Tn   barge-in check (suppressed during echo grace) OR silence flush
Tn   STT partials → safetyNet.onPartial ; STT final → turn entry
Tn+  transcript-quality + guardrail checks ; KB race (≤200ms telephony)
Tn+  LLM stream: first token (filler if slow), tokens filtered
Tn+  extractSentences → per-sentence TTS synth + playback
Tn+  [optional] tool call → tool-executor → continue/loop
Tn+  recording.addCallerChunk / addAgentChunk throughout
Tn++ playback drained ; tail/echo grace re-armed ; back to LISTENING
─── end ────────────────────────────────────────────────────────────────
Te   trigger: silence/maxDuration/end_call/error/WS close
Te   close()/clear timers (telephony) | hangup() inline (web)
Te   recording.finalize → call_recordings
Te   calls finalized (duration, transcript, recording URL)
Te   recordUsage → usage_events (stt/llm/tts)
Te   billing: resolveAgentBillingMode → users.walletBalanceCents, wallet_transactions
Te   agents rolling metrics updated
Te   writeCallEndedLog → execution_logs
Te+  async: summary, disposeCall → call_dispositions, webhook fire
Te+  async: updateCallerProfile → caller_* tables
Te+  async: TRAI opt-out scan, DPDP PII redaction
```

---

## 9. Risk Map

Ordered roughly by blast radius. "Hidden coupling" = the non-obvious thing that
breaks when you edit naïvely.

1. **`pipeline.ts` ↔ `webcall.ts` divergence (highest risk).** The two paths are
   copies that drift. The classic traps:
   - `extractSentences` has **different return types** (object vs tuple). Copying a
     call site across files compiles to garbage or crashes.
   - Barge-in / echo-grace logic uses **different variable names and value sources**
     (agentConfig vs hardcoded). A fix in one path silently leaves the other broken.
   - Finalization is duplicated in `endSession` vs `hangup`. Billing/usage/memory
     changes must land in both.
   - Transfers and SMS exist only on telephony.
   *Mitigation:* always grep both files for the symbol/behavior before editing; treat
   §1.5 as a checklist.
2. **Billing & wallet deduction** (`session.ts::endSession`, `webcall.ts::hangup`,
   `minute-rates.ts`, `record-usage.ts`). Errors here are financial. Managed vs BYOP
   resolution is **dynamic at call end** (any matching provider key → BYOP rate).
   A mistake double-charges or under-charges.
3. **Turn safety net & endpointing** (`endpointing.ts`). The shared backstop against
   the "Listening…" hang. The safety net is **Listening-state-only**; mis-wiring it
   into the speaking/processing path reintroduces hangs or cuts callers off.
4. **Audio encoding boundaries** (`audio.ts`, `audioPool.ts`, telephony handlers).
   μ-law vs PCM, 8 kHz vs 16 kHz, and Vobiz's no-byte-swap linear PCM. Wrong
   transcode → "tractor noise" / garbled audio. Web call must stay 16 kHz PCM.
5. **Recording alignment** (`recorder.ts`). Track alignment is audio-cursor primary;
   per-frame wall-clock padding buzzes the agent channel (`GAP_RESYNC_MS` guard).
   Sample rate must match the path (8000 vs 16000).
6. **Caller memory writes** (`callerMemory.ts`). Fact supersession and identity
   contamination (stored name vs self-stated name). Managed-plan calls must fall back
   to the platform key for the post-call extraction or memory silently no-ops.
7. **Tool execution** (`tool-executor.ts`, transfer/SMS). Native scheduling tools
   write real bookings; transfers redirect live legs. Tool-name sanitization matters
   for cross-provider (Gemini/OpenAI) compatibility.
8. **HTTP keep-alive pool** (`http/pool.ts`). Process-wide `setGlobalDispatcher`;
   changing keep-alive timeouts affects *every* outbound HTTP call. Too short → every
   turn re-pays TCP+TLS handshake.
9. **Compliance scans** (`services/trai/*`, `services/dpdp/*`). Must stay
   **pre/post-only and non-blocking** — never insert into the dial/turn path or they
   gate live calls.
10. **DB schema/migrations** (`lib/db/`). New tables/columns need a real migration
    file with a fresh timestamp; raw-SQL-only columns drift and can be dropped by
    `drizzle-kit push`. The Drizzle migration folder must be present in the prod
    image.

---

## 10. Engineering Guide

### 10.1 Run & verify locally

```bash
pnpm --filter @workspace/api-server run dev    # API + orchestration (port 8080, /api)
pnpm --filter @workspace/dashboard run dev     # frontend (port 23183, /)
pnpm run typecheck                             # full typecheck (libs then leaves)
pnpm run typecheck:libs                        # after editing lib/db schema
```

- The api-server runs a **prebuilt esbuild bundle with no hot-reload** — **restart
  the workflow after editing routes/middleware** or new endpoints 404.
- Verify a service via the shared proxy: `curl localhost:80/api/healthz` (never call
  service ports directly).

### 10.2 Golden rules when touching the call loop

1. **Edit both paths.** If your change touches turn logic, barge-in, sentence
   streaming, echo grace, recording, usage, billing, disposition, or memory, open
   **both** `pipeline.ts` and `webcall.ts` and apply the change to each. Use §1.5 as a
   checklist.
2. **Mind `extractSentences` shape.** `pipeline.ts` →
   `{ sentences, remainder }`; `webcall.ts` → `[sentences, remainder]`. Never copy a
   destructuring pattern between files.
3. **Barge-in/echo grace re-arm.** Re-arm grace **per sentence-start and at the
   playback tail** — never per chunk/frame (callers can't interrupt long replies) and
   never anchored to a single `speakingStartedAt`.
4. **Don't unify deliberately-different constants.** Telephony (μ-law, 8 kHz, carrier
   AEC) and web (PCM, 16 kHz, browser AEC) have different energy/grace tuning on
   purpose.
5. **Compliance stays off the hot path.** TRAI/DPDP scans are post-call,
   fire-and-forget, and must never gate dialing or a turn.
6. **Managed-key fallback.** Anything that runs an LLM at call end (summary,
   disposition, memory extraction) must fall back to the platform managed key
   (`platform_settings`) → `GROQ_API_KEY`, or it silently no-ops on managed-plan
   calls.

### 10.3 Adding a provider

- **STT/TTS/LLM:** add a file under the matching `adapters/<kind>/` directory and
  register it in that directory's `index.ts` factory (`createSTTAdapter` /
  `createLLMAdapter` / `createTTSAdapter`). Honor the 16 kHz PCM I/O contract (§5.3).
- **Telephony:** add a WS handler under `orchestration/telephony/` plus dial/transfer
  functions in `dial.ts` / `transfer.ts`. Transcode to/from 16 kHz PCM at the
  boundary; confirm byte order (Vobiz is LE, no swap).

### 10.4 Changing the API contract

Contract-first. Edit `lib/api-spec/openapi.yaml`, then:

```bash
pnpm --filter @workspace/api-spec run codegen   # regen hooks + Zod schemas
pnpm run typecheck:libs                          # before touching backend routes
```

Generated hooks (`lib/api-client-react/src/generated/`) and Zod schemas
(`lib/api-zod/src/generated/`) are **do-not-edit**.

### 10.5 Changing the database

- Add/modify a table in `lib/db/src/schema/`, run `pnpm run typecheck:libs`, then
  `pnpm --filter @workspace/db run push` (dev only).
- New tables/columns need a real migration file with a fresh `when` timestamp — the
  bootstrap journal seeds old migrations without running their SQL.

### 10.6 Tests to run for orchestration changes

- `orchestration/extract-sentences.test.ts` — sentence splitting incl. Indic/Tamil
  boundaries (no dropped tail / duplicated head).
- `orchestration/turn-safety-net.test.ts` — force-finalize after `FORCE_FINALIZE_MS`,
  recovery reprompt after `STALL_BACKSTOP_MS`.
- `orchestration/reasoningFilter.test.ts`, `orchestration/conversationDiscipline.test.ts`.

### 10.7 Where to start reading for a given task

| Task | Start here |
| :--- | :--- |
| "Agent cuts callers off / won't let them interrupt" | barge-in in `pipeline.ts::handleProcessedAudio` + `webcall.ts` message handler; echo-grace re-arm |
| "Last words get clipped" | `pipeline.ts::drainPlaybackTail` / `webcall.ts` tail-silence + margin |
| "Listening… hang" | `endpointing.ts::TurnSafetyNet` |
| "Wrong charge on a call" | `minute-rates.ts` + finalization in `session.ts`/`webcall.ts` + `record-usage.ts` |
| "Agent forgot a returning caller" | `callerMemory.ts` (`loadCallerContext`, `injectEnhancedMemory`, `updateCallerProfile`) |
| "Garbled / robotic audio" | `audio.ts`, `audioPool.ts`, telephony handler transcode; `recorder.ts` for recording-only artifacts |
| "Add a booking/transfer capability" | `services/tool-executor.ts` + transfer in `pipeline.ts` |

---

*End of reference. Keep this document honest: when you change the orchestration code,
update the relevant section here in the same change.*
