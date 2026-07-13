# Bolna → VoiceOrch: Design Notes & Gap Analysis

Reference studied: Bolna OSS (`bolna/agent_manager/task_manager.py` 6.6k lines,
`constants.py`, `enums.py`, `providers.py`, telephony in/out handlers). Bolna is
**Python** and is used here **only as a design reference** — nothing is ported or
run. All target code is TypeScript in `artifacts/api-server/src/orchestration/`.

This file has two parts:
- **STEP 1** — language-agnostic patterns worth borrowing.
- **STEP 2** — how VoiceOrch already compares, and where the real gaps are.

---

## STEP 1 — Bolna patterns (language-agnostic)

### 1. Queue-decoupled stage pipeline
Each stage is an independent `asyncio` task wired by its own queue:
`input → queues["transcriber"] → queues["llm"] → synthesizer → buffered_output_queue → output loop`.
- Input handler batches ~100 ms of audio then `put_nowait` to the transcriber queue.
- `_listen_llm_input_queue` pulls a finalized transcript and runs the LLM task.
- `__listen_synthesizer` async-iterates the synthesizer and pushes audio frames
  to `buffered_output_queue`; a separate output loop drains and transmits.
- **Benefit:** stages never block each other; interruption = cancel a task + drain a queue.

### 2. Streaming, clause-by-clause LLM → TTS
`__do_llm_generation` `async for`-iterates `llm_agent.generate(...)`. Text is
buffered until a **sentence/clause boundary**, then handed to the synthesizer so
the first audio plays long before the LLM finishes. Synthesizer output is chunked
into the output queue.

### 3. Interruption / barge-in cascade — strict teardown order
`__cleanup_downstream_tasks()` (the canonical sequence):
1. `_cancel_in_flight_llm_response()` (abort the LLM HTTP stream)
2. `output.handle_interruption()` (tell telephony to **clear** buffered audio)
3. `synthesizer.handle_interruption()` then `flush_synthesizer_stream()`
4. cancel output / llm / eager-llm / first-message / synthesizer tasks
5. **reconcile history from playback marks** (`sync_history`) — store only what
   the caller *actually heard*, not the full generated reply
6. empty `buffered_output_queue`, restart the output loop, reset transmit flags.

### 4. Interruption *detection* gating (avoid false barge-ins)
`InterruptionManager.should_trigger_interruption(word_count, transcript, is_audio_playing, welcome_played)`:
- **word-count gate** (`number_of_words_for_interruption`, default 3),
- **accidental-interruption phrases** (`stop/wait/no/…`) handled specially,
- **continuation grace**: within `incremental_delay` (~100 ms) a follow-on user
  utterance cancels a *pending* response rather than counting as a new turn,
- **late-delivery guard**: a duplicate final arriving after force-finalize is ignored.

### 5. Sequence-id validity (stale-audio suppression)
Every response chunk carries a `sequence_id`; the synthesizer listener only emits
frames when `interruption_manager.is_valid_sequence(sequence_id)`. Fillers use
`sequence_id == -1` (always valid). Cancelled turns can never leak audio.

### 6. Endpointing + safety nets (most relevant to our Tamil hang)
Layered timeouts, all as named constants:
- `DEEPGRAM_FLUX_EOT_TIMEOUT_MS = 500` — **max silence before forcing end-of-turn**.
- `DEEPGRAM_FLUX_TURN_STALL_FLOOR_S = 3.0` — min a turn may stay open with no
  transcriber events before it is **force-closed**.
- `hangup_after_silence = 10`, `DEFAULT_USER_ONLINE_MESSAGE` ("Hey, are you still
  there?") after `DEFAULT_USER_ONLINE_MESSAGE_TRIGGER_DURATION = 6`.
- `STALL_HANGUP_FLOOR_S = 20` — inactivity backstop (`_should_stall_hangup`):
  if no AI word **and** no user word for `max(hangup_after_silence, 20)`s, hang up
  even when a pipeline flag is stuck. **This is the "safety net" idea.**

### 7. Filler injection
- `use_fillers` flag injects `FILLER_PROMPT` into the system prompt.
- `FILLER_DICT` — categorized fillers (Unsure / Positive / Negative / Neutral /
  Explaining / Greeting / …); plain list `FILLER_PHRASES`.
- **Pre-function-call filler** ("Just give me a moment, I'll be back with you.")
  spoken before a slow tool runs.
- Fillers are pre-rendered `.wav` presets read from disk (zero TTS latency),
  emitted as `message_category="filler"`, `sequence_id=-1`.

### 8. Provider registry pattern
Dict registries keyed by enum value → class:
`SUPPORTED_SYNTHESIZER_MODELS`, `SUPPORTED_TRANSCRIBER_PROVIDERS`,
`SUPPORTED_LLM_PROVIDERS`, `SUPPORTED_INPUT/OUTPUT_HANDLERS`. Clean
add-a-provider extension point.

### 9. Mark-based playback accounting
Telephony output emits pre-mark → media → post-mark; each mark carries
`sequence_id/turn_id/response_uid` + synthesized text + `sent_ts`. On interruption,
acknowledged marks tell exactly which words reached the caller, so history stays
truthful. (Heavier than we need, but the *principle* — truncate history to what
was heard — is worth noting.)

---

## STEP 2 — VoiceOrch comparison (what exists vs. what's missing)

VoiceOrch has **two parallel paths** that must stay in sync:
`orchestration/pipeline.ts` (telephony) and `orchestration/telephony/webcall.ts`
(browser WS). Both already import the shared `endpointing.ts` and both have their
own `extractSentences`.

| Bolna pattern | VoiceOrch today | Verdict |
|---|---|---|
| **2. Streaming clause-by-clause LLM→TTS** | `processTurn`: LLM `chat()` streams tokens → think/fn/markup filters → `pendingText` → `extractSentences()` → `enqueue()` → `playTask` producer/consumer (via `wakePlayer` promise) → `playSentence()`. `incrementalDelay` supported. | **Already implemented** (both paths). |
| **2b. Clause boundary detection** | `extractSentences()` handles `. ! ? …`, Indic danda `U+0964`, abbreviation guard, **comma-clause fallback** for long text (≥60 chars). | **Already implemented.** |
| **7. Filler on slow LLM (TTFT)** | `FILLER_THRESHOLD_MS = 800` + `FILLER_PHRASES`; `fillerTimer` fires if no first token in 800 ms, cancelled on first token. Plus language-aware `TOOL_FILLERS` before tool calls. | **Already implemented** (no preset-wav caching; synthesized live). |
| **3/4. Barge-in** | `bargeInRequested` flag; energy gate (`BARGE_IN_ENERGY_THRESHOLD`) + streaming-STT word-count gate + `isSemanticInterrupt` override; echo grace (`bargeInHoldUntil` / `armTailEchoGrace`); `playTask` breaks on barge-in. | **Partially** — detection is solid; **teardown is simpler** than Bolna (no sequence-id gate on TTS, no mark-based history reconciliation). |
| **5. Sequence-id stale-audio suppression** | None — relies on the `bargeInRequested` flag + breaking the play loop. | **Missing** (lower priority; current flag works for single-turn). |
| **9. History = only what was heard** | After a turn, full `cleanResponse` is pushed to history regardless of how much actually played before a barge-in. | **Missing/divergent** (acceptable for now). |
| **6. Adaptive endpoint window** | `computeEndpointMs()` — digit-collection (`policy/otp/aadhaar…`), dangling words, affirmations, terminal punctuation, audio-duration proxy. `scheduleSilenceFlush()` uses it. | **Already implemented, and richer than Bolna.** |
| **6. Inactivity hangup** | `resetHangupTimer()` → `silenceTimeoutSeconds` → `playInactivityMessageAndEnd()`. | **Implemented** (no "are you still there?" mid-call nudge). |
| **6. HARD safety-net / force-finalize a stuck turn** | **NONE.** If STT never returns a final (the Tamil "Listening…" hang), `scheduleSilenceFlush` is never armed (no final ⇒ no `_tTurnSttFinal`, and the flush is driven off finals), so the turn never closes. There is no `max-wait → force-finalize` and no Bolna-style stall floor. | **MISSING — this is the real gap.** |
| **1. Queue-decoupled tasks** | Single `processTurn` with an in-function producer/consumer (not separate long-lived tasks/queues). | Divergent by design; **fine** — not worth a rewrite. |
| **8. Provider registry** | `createSTTAdapter` / `createLLMAdapter` / `createTTSAdapter` factories in `adapters/*/index.ts`; `adapters/stubs.ts` + `STUB_PROVIDERS`. | **Equivalent** to Bolna's registry dicts. |

### Latency checkpoints (`performance.now()`)
Already present in `pipeline.ts`:
`_tTurnVadFlush`, `_tTurnSttFinal`, `_tTurnLlmFirstToken`,
**`_tTurnLlmFirstClause`** (first clause flushed), `_tTurnTtsFirstByte`,
**`_tTurnFirstAudioOut`** (first audio chunk out).
- The task asked to *add* "first LLM clause" and "first TTS audio out" — **both already exist.**
- The only genuinely new checkpoint needed: **"turn closed — final vs forced"**
  (did the turn end on a real STT final, or did the safety-net force it?).

---

## STEP 3 — SHIPPED: two-timer turn safety-net + close-reason metric

The comparison narrowed four assumed builds down to one surgical fix, now **done**.

**STEP 0 finding: PARTIALS PRESENT.** In the Tamil/Hinglish "Listening…" hang the
STT streams non-empty interim transcripts but never emits a `is_final`, so the
final-driven `scheduleSilenceFlush` is never armed and the turn never closes. The
common case is "partials, no final"; the degenerate case is "nothing usable".

Implemented (shared logic in `endpointing.ts`, wired identically into both
`pipeline.ts` and `telephony/webcall.ts`):

1. **FORCE-FINALIZE timer** (`FORCE_FINALIZE_MS`, default 1800) — armed on the first
   non-empty partial, reset on each subsequent partial. On expiry, force-closes the
   turn from the best partial → LLM, exactly as a real final would. Guard: empty
   best-partial falls through to the stall path, never sent to the LLM.
2. **STALL BACKSTOP timer** (`STALL_BACKSTOP_MS`, default 15000) — armed at
   Listening, cleared by a real final or a successful force-finalize. On expiry with
   no usable transcript, speaks a language-aware recovery reprompt and re-enters
   Listening (no hangup — outbound insurance hangups are lost leads). After
   `STALL_MAX_REPROMPTS` (default 2) it ends the call via the existing inactivity path.
3. **Metric** `turn_close_reason ∈ {stt_final, force_finalized, stall_reprompt}` added
   to the existing `turn_latency` log line. No new `performance.now()` checkpoints.

**Design invariant:** the safety net is a *Listening-state* mechanism only — dormant
during agent speech. `onPartial` is gated on "not playing/speaking"; `onFinal` is
**deferred** to the point a transcript is actually accepted (after echo/leftover
discards) so a discarded transcript cannot silently clear the stall backstop. A
normal English turn ending on a real STT final fires neither timer (verified by
test). Barge-in teardown, `processTurn`, sequence-id gating, and the provider
abstraction were left untouched per approved scope.

Tests (`turn-safety-net.test.ts`, `STUB_PROVIDERS=1`): force_finalize reaches the
LLM; empty-partials → stall reprompt → give-up; real-final fires neither;
`clear()` cancels; recoveryReprompt language fallback. 6/6 pass.

---

## STEP 4 — Bolna's low-latency trick ("no 1000 ms latency")

The headline trick is **speculative / eager LLM execution**, made possible by
Deepgram **Flux**'s two-stage end-of-turn signalling. It removes the dead time
normally spent (a) waiting to *confirm* the user finished and (b) the LLM's
time-to-first-token — by overlapping them.

### How it works
Flux emits two signals per turn, each with an `end_of_turn_confidence`:
- **`EagerEndOfTurn`** at confidence ≥ `DEEPGRAM_FLUX_EAGER_EOT_THRESHOLD` (0.5) —
  fired *early*, before the user has definitely stopped.
- **`EndOfTurn`** at confidence ≥ `DEEPGRAM_FLUX_EOT_THRESHOLD` (0.7), or **forced**
  after `DEEPGRAM_FLUX_EOT_TIMEOUT_MS` (500 ms) of silence.

On `EagerEndOfTurn`, Bolna **speculatively launches the LLM task** against the eager
transcript (`eager_llm_task`), snapshots history (`eager_history_snapshot`), and lets
it run *during* the endpointing/silence window. Two outcomes:
- **Eager was right:** the real `EndOfTurn` arrives carrying `was_eager=true`; Bolna
  **reuses the already-running eager LLM task** (revalidating its `sequence_id`)
  instead of starting fresh — the LLM has had a ~300–800 ms head start, so first
  audio is ready almost immediately on confirmation.
- **Eager was wrong** (user kept talking): `eager_llm_task.cancel()` + rewind history
  to the snapshot. The speculative TTS never leaks because cancelled sequence-ids are
  invalidated (the sequence-id gate — Bolna pattern #5).

Net effect: the ~500–1000 ms normally lost to "confirm end-of-turn → *then* call LLM"
collapses to near-zero on confident turns, while the higher commit threshold (0.7)
and the cancel/rewind path protect against acting on false ends.

### Supporting latency mechanisms (secondary, but real)
- **Shared HTTP/2 connection pool** (`llms/http_client_pool.py`): one keep-alive
  `httpx.AsyncClient` (200 conns, 30 s keepalive, http2) reused across LLM/TTS calls,
  eliminating per-call TCP + TLS handshakes (~100–300 ms each).
- **Streaming clause-by-clause LLM→TTS** with first-chunk latency stamping
  (`stream_synthesizer.py`): first audio plays before the LLM finishes.
- **Tight Deepgram endpointing** (`endpointing="400"`, interim results on).

### VoiceOrch status (2026-07)
VoiceOrch does not use Deepgram Flux, but ships a **Flux-free eager path** on Sarvam:
`END_SPEECH` VAD + stable partials launch speculative LLM (`eager-stt.ts`), reused on
`isSpeculativeHit` in `processTurn()`. The **sequence-id stale-audio gate**
(`InterruptionManager` + `activeAgentSequenceId`) is wired — cancelled turns cannot
leak audio. Turn Metrics now include `turnCloseReason` and `eagerLlmHit` for latency
debugging. Remaining gap vs Bolna: queue-decoupled stage tasks (Python asyncio model);
VoiceOrch uses a single-threaded async pipeline with shared state instead.

**Reference (`/tmp/bolna-ref`) consumed and deleted after this writeup.**
