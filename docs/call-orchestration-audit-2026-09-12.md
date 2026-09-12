# Call orchestration audit — 12 September 2026

## Verdict and scope

The model stack is viable. There are concrete integration defects and gaps in turn ownership, audio delivery accounting, and input processing. Replacing Sarvam 105B with another LLM would not repair them. Conversely, matching Pipecat/Bolna model names does not establish equivalent call quality.

This is a call-critical source audit with deterministic regression tests, not a production certification or a claim that every repository bug has been found. Reviewed paths: Vobiz start/media/close; session configuration and teardown; audio codec/filter/worker routing; streaming STT; endpoint/semantic-turn/interrupt policies; speculative and committed LLM paths; TTS adapters, sentence jobs and playback; history trimming and tool continuation boundaries. Public documentation comparison is not a benchmark against the hosted Bolna product.

Baseline: `44026d2` (the earlier TTS continuity, bandpass and EOS fixes). The changes accompanying this report are additional fixes. No production settings, credentials, provider accounts, deployment, or real calls were changed. The original Documents checkout was left untouched; work used the hydrated checkout because the original had iCloud file-read stalls.

## What the supplied call actually shows

Call 24697 used **Sarvam STT + Sarvam 105B conversations + Sarvam TTS**, not Cartesia. Recording was disabled. Do not use this call to claim that Sonic 3.5/3.6 sounded bad, or that a particular DSP defect caused its acoustic symptoms.

| Observation | Interpretation / limit |
| --- | --- |
| Answer to first audio: 3,411 ms; setup: 2,871 ms; pipeline: 540 ms | Setup is the majority of this opening delay. Subphase DB/provider/network spans are needed before attributing its cause. |
| LLM first token: approximately 447–568 ms | This is not full response generation time and not user-to-audible-response latency. |
| STT speech-end-event to final: approximately 74–145 ms | Excludes silence already spent deciding that speech ended. It does not measure total endpointing latency. |
| TTS first-byte values reach approximately 2.2 seconds | Sarvam serial queue time can be included. Prefetch may overlap previous playback; this alone does not prove an audible gap. |
| Mid-phrase synthesis chunks, long replies, repeated fillers/questions | Supports orchestration and conversation-design investigation. The preceding commit already changed sentence boundaries; those changes still require live evaluation. |
| No call recording | Noise suppression, clipping, speakerphone echo and subjective voice quality cannot be diagnosed conclusively from this log. |

## Additional defects fixed in this patch

| Priority | Defect and location | Change / regression coverage |
| --- | --- | --- |
| P1 | `telephony/vobiz.ts`: `media` was discarded until asynchronous `createSession` returned | Retain up to five seconds (80,000 bytes) of PCM8k during setup, deliver in arrival order once ready, discard on stop/close/error. Test actual socket handler with deferred setup, excluded outbound track, overflow and termination. This preserves transport input; downstream greeting/AMD policies can still choose not to commit it. |
| P1 | `adapters/tts/sarvam.ts`: WS failure after emitting audio retried the whole text and could eventually repeat it through HTTP | Only retry before any nonempty audio escapes. After partial output, surface the error, release the queue slot and never replay the whole prefix. Test partial-output failure and successful next turn. This prevents repetition; it cannot reconstruct a lost tail without alignment. |
| P1 | `pipeline.ts:startSentenceSynthesis`: delayed aborts could launch REST recovery after the global barge flag reset; old callbacks could write bytes/metrics | Recovery now requires an actual job timeout; callback, buffering and fallback completion checks also validate the job's sequence. Tests exercise the real producer method, including late cancellation, late bytes and fallback completing after invalidation. This is not yet universal cancellation of all provider REST requests. |
| P2 | `pipeline.ts`: recovered one-shot bytes were omitted from counters, then `finally` overwrote recovered duration with zero | Count recovered bytes/duration consistently; regression verifies 200 ms PCM recovery and response telemetry. |
| P1 on μ-law paths | `audio.ts`: 14-bit bias/clipping constants were used with 16-bit PCM; zero decoded nonzero and loud speech clipped | Correct PCM16-domain G.711 encode/decode. Reference vectors, all 256 code round trips, silence and loud speech tests. Normal Vobiz PCM bypasses this codec, so this is not presented as that call's proven cause. |
| P2 | `adapters/stt/sarvam-realtime.ts`: v4 selection still built a v3 URL | Map v3/v4 aliases to their actual realtime wire model; preserve explicit realtime routing and log the effective model. No automatic v3→v4 upgrade. Legacy fallback remains a separate compatibility path. |

Regression files: `audio.mulaw.test.ts`, `pipeline-tts-lifecycle.test.ts`, `telephony/vobiz-startup-audio.test.ts`, `adapters/tts/sarvam-serialization.test.ts`, `adapters/stt/sarvam-realtime.test.ts`, under `artifacts/api-server/src/orchestration/`.

## End-to-end architecture assessment

| Stage | Existing protection worth retaining | Remaining gap / next contract |
| --- | --- | --- |
| Answer and session setup | Duplicate-call guard, early ambient, teardown when setup finishes after disconnect | Measure config/DB/key resolution/provider warmup separately. Ambient masks silence but does not shorten setup. Startup audio is now bounded; original capture timestamps and AMD wall-clock semantics still need end-to-end replay coverage. |
| Incoming audio | Sticky per-call worker placement, raw recording tap, continuous filters | Validate `start.mediaFormat`; carry encoding, rate and capture timestamp explicitly. A native 16 kHz or μ-law stream must not be treated as PCM8k. Current XML requests PCM8k, but the handler does not validate the advertised format. |
| Denoising and speech activity | Provider input is not globally muted while the bot speaks; configurable software gate | The RMS gate is not speech-aware denoising or acoustic echo cancellation. Calibration can learn immediate speech as noise. Separate denoising from VAD and from transcript-based echo rejection. |
| Endpoint and final transcript | Semantic turn gate has generation checks; realtime STT produces partials and finals | Realtime Sarvam uses `sarvamEndOfSpeechSilenceMs` through extra config. Generic `asrEndpointingSilenceMs` reaches STTConfig but is not read by that adapter. Expose effective values and their source; do not silently apply the generic 250 ms default to all Sarvam agents. |
| LLM and tools | Sarvam conversation model streams; reasoning disabled unless requested; speculative path separated from committed output | Keep speculative calls side-effect-free. Give every tool result a captured turn ID and idempotency key for side effects; audit delayed-result reconciliation before refactoring this area. No tool-side-effect race is claimed proven by this patch. |
| Text to TTS | Cartesia contexts and Sarvam serialized WS flushes; preceding commit repaired continuity | Normalize text once at meaningful boundaries, not independently on arbitrary tokens. Current generic regexes remove parenthetical text, currency symbols and change long ALL-CAPS words. Those are product-specific rewrites, not universal pronunciation rules. |
| Synthesis queue | Prefetch and real PCM queues | Sarvam waits its serialization slot while the pipeline's first-byte timer already runs. Split queue deadline from provider first-byte/idle deadlines. Bound producer lead in milliseconds, not merely number of jobs. Preserve serialization on the nonmultiplexed Sarvam socket. |
| Audio output | Exact wire frames, paced drain, persistent decimator, stale-sequence gate | One output owner, bounded socket backlog, measured jitter buffer. Prebuffer/rebuffer defaults are currently zero despite comments describing hundreds of milliseconds. No universal replacement value is justified without traces at actual load. |
| Interruption and history | Sequence invalidation, provider aborts, `clearAudio`, history trimming | Consolidate generation/sequence/cancellation ownership. Carrier acknowledgement is not integrated into history. Current 85% local-duration completion threshold is an estimate, not proof of hearing the final words. |
| Hangup/transfer | Session removed before async post-call work; transfer flag prevents unwanted WS close | Distinguish synthesis complete, locally sent, carrier played, and cleared. Terminal events must not wait forever for playback acknowledgements that were invalidated by interruption. Test disconnect during final speech, tool execution and transfer. |

### Highest-impact unresolved items

1. **Speech-safe denoising (P1).** `NoiseCanceller` learns the first 25 frames as ambient, then attenuates below 4× its floor to 0.15. A deterministic 1 kHz, amplitude-4000, one-second signal starting immediately at connection measured **0.150027× post-calibration amplitude** relative to bandpass-only output. This is a synthetic calibration counterexample, not a human-speech quality score. Do not “fix” it by increasing gain or inventing another universal RMS threshold. Evaluate a speech-aware denoiser/AEC arrangement with quiet speech, immediate hello, fans, music and double-talk. Until then, A/B software gate on/off on controlled test calls; do not globally change customer settings without evidence.

2. **Carrier playback acknowledgement (P1).** Vobiz documents outbound `checkpoint` and inbound `playedStream` with top-level `name`. The handler currently recognizes `mark`, and the pipeline's `onAudioMarkAck` only logs. It neither sends utterance checkpoints nor reconciles acknowledged playback into history/hangup. Implement a bounded playback ledger with unique names, explicit cleared/timeout states, and per-turn ownership. Missing ack after `clearAudio` is expected, not success. [Vobiz checkpoint protocol](https://www.vobiz.ai/docs/xml/stream/checkpoint-event).

3. **Greeting/stop policy (P1 UX risk, deliberate current behavior).** `shouldDiscardOpenerTranscript` returns true unconditionally. `shouldCutTtsFromCallerTranscript` requires welcome playback to be over even for stop/hold phrases. Thus buffering initial media is necessary but not sufficient to honor caller requests during the opener. Define an explicit rule: suppress probable echo/chatter, but permit trusted stop/hold requests. Review all greeting guards together and replay recordings before changing only one gate. Bolna's public engine documentation describes immediate stopword handling; comments claiming universal “Bolna parity” in this code are not validation. [Bolna engine settings](https://www.bolna.ai/docs/agent-setup/engine-tab).

4. **Format and queue contracts (P1 under mismatch/load).** The Vobiz handler assumes PCM8k; audio workers keep a pending map without a per-request deadline; TTS can accumulate ahead of playback. Add negotiated-format validation and bounded queue age/backpressure with explicit overload outcomes. Do not repair overload by playing stale audio faster or by restarting full sentences.

5. **Reproducible latency accounting (P2).** Retain distinct `queued_at`, `dispatched_at`, `first_provider_audio_at`, `first_wire_audio_at`, and `carrier_checkpoint_ack_at`, plus caller acoustic end and STT final. Missing measurements must remain unavailable, not zero. Current setup/TTFT/first-byte numbers are not interchangeable.

## Provider configuration assessment

**Sarvam LLM:** Keep `sarvam-105b-conversations` for this evaluation. The adapter uses `/v1/chat/completions`, streaming, and explicit null reasoning unless requested. A 500-token ceiling is a cap, not a conversation-length target. Test a concise task prompt with one question per response; do not assume lowering token limits fixes prompt repetition or booking state. [Sarvam chat API](https://docs.sarvam.ai/api-reference/chat/chat-completions).

**Sarvam STT:** v3-realtime and v4-realtime share the documented protocol. The adapter defaults to `fast` partials and server VAD; unset VAD overrides leave provider defaults. Sarvam documents 500 ms silence, 250 ms minimum speech and threshold 0.3. Treat these as a measured starting point, not a guarantee. Keep single-language pinning and explicit caller language changes separate from passive language detection. The accompanying fix honors model selection rather than changing every agent's model. [Sarvam realtime STT](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming).

**Cartesia:** The repository already defaults to `sonic-3.6` and permits explicit Sonic 3.5. For repeatable comparisons, pin the voice and a documented snapshot rather than a preview alias. Current docs identify `sonic-3.6-2026-08-27` as stable and describe 3.6 as backwards-compatible with 3.5. This is not evidence that changing the snapshot alone will repair our pipeline. [Sonic 3.6 documentation](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest).

Use one continuing context per reply, preserve joined transcript text, and finalize only after all inputs. Cartesia's documented managed buffer default is 3000 ms; that is a maximum buffering policy, not a mandatory delay to add to every turn. Do not combine that with arbitrary client-side holds or frequent independent short syntheses. The preceding commit fixed multiple continuity failures; this audit additionally identifies generic per-token normalization and playback accounting as risks. [Cartesia continuations](https://docs.cartesia.ai/build-with-cartesia/capability-guides/stream-inputs-using-continuations).

**Vobiz:** Inbound and outbound formats are independent. XML `contentType` negotiates inbound; `playAudio` describes outbound. Current PCM8k output is valid, but PSTN quality is not comparable directly with a wideband browser demo. The earlier code comment claiming both directions must match was incorrect and has been corrected. Validate real advertised input and actual output bytes; do not change endian/rate based on the MIME label alone. [Vobiz streaming formats](https://www.vobiz.ai/docs/concepts/streaming-websockets).

## What to borrow from Pipecat / Bolna

Adopt explicit control contracts, not branding or scattered default constants. Pipecat separates interruption control from queued data and defines terminal/flush frames; its observers distinguish user-to-bot latency from component metrics. Our corresponding work is a unified turn owner, cancellation propagation, bounded transport drain and truthful timestamps. [Pipecat frames](https://reference-server.pipecat.ai/en/latest/api/pipecat.frames.frames.html), [Pipecat metrics](https://docs.pipecat.ai/pipecat/fundamentals/metrics).

Bolna describes reconstruction of the actually delivered part of interrupted speech. Our current estimated-history approach is a partial approximation, not equivalent delivery evidence. A carrier-aware ledger plus TTS word alignment is the concrete next step. [Bolna precise transcripts](https://www.bolna.ai/docs/customizations/capturing-precise-transcripts).

Do not rewrite the entire TypeScript engine into Pipecat in one change. First extract narrow interfaces for transport, turn ownership, synthesis scheduling, and playback ledger; retain provider/business integrations and run identical replay tests against each extraction.

## Verification and release gate

- API server tests: **170 files, 1,494 tests passed** including the new fault-injection cases.
- API server production bundle: **passed**.
- `git diff --check`: **passed**.
- Repository typecheck: **still fails on pre-existing errors**, including LLM `toolChoice` declarations/import, nullable endpointing language, and admin/callback/lead routes. No new diagnostics in this patch's files were introduced. A bundle passing is not a substitute for a clean typecheck.
- Not performed: production deployment, provider-account tests, real Vobiz calls, listening tests, load benchmark, or hosted Bolna/Pipecat comparison.

Before broad rollout, use consented test calls with the same voice, model snapshot, language, prompt, carrier and deployment region. Cover immediate hello; soft yes/no; stop during greeting; interruption mid-clause; Hindi/Tamil/English switching; dates/emails/numbers; silence; double-talk; network stall after first TTS chunk; missing final/ack; disconnect during setup/tool/transfer. Capture separate input/output audio where permitted. Record p50/p95 acoustic-end-to-first-audible response, interruption stop time, lost/repeated words, underrun duration, queue age and cleanup counts at increasing concurrency. Set acceptance thresholds before running the comparison; do not invent achieved latency or MOS scores from unit tests.
