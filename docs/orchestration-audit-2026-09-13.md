# Voiceorch orchestration audit — 13 September 2026

Historical audit of revision 36839a1. For the subsequent implementation, tests and outstanding production work, see [hardening release notes](orchestration-hardening-2026-09-13.md). Findings below describe the pre-fix baseline, not the current working tree.

## Verdict

**REQUEST CHANGES.** Confidence is high for the reproduced behaviors and explicit control-flow defects; medium for provider-contract and load-dependent risks. The primary model choices are reasonable. The orchestration is not yet demonstrated ready for 30,000 production calls/day.

Reviewed revision: `36839a1788acb6a4373eb8425967df2bdf0b82f3` on `main`, matching GitHub when checked. This is a targeted end-to-end audit of the Sarvam STT → Sarvam conversations → Cartesia → Vobiz path, including interruption, session lifecycle, KB retrieval and generic tools. It is not a claim that every repository file, alternate provider or possible bug has been examined.

The code-review skill provided the severity/evidence structure. Because the user requested a whole-pipeline audit, findings include pre-existing defects, not only the last commit.

No application code, production settings, deployments or GitHub state were changed during this audit. This report is new local documentation only.

### Evidence and limits

- Inspected the current repository, recent fix, supplied call 24710 log, relevant official Sarvam/Cartesia/Pipecat documentation, and Vobiz's official example repository.
- Executed five isolated checks against actual functions: short-reply classification, interrupted heard-text history, mismatched text remainder, webhook retry, and tool status reporting. The webhook check mocked fetch; it did not contact a customer webhook.
- The earlier fix's 1,524 passing tests and successful build are not proof of these untested orchestration invariants. The full suite was not rerun for this read-only audit.
- No fresh production recording, deployed configuration snapshot, confirmed Railway active SHA, provider quota inventory, or multi-replica load test was available. Audio quality and production improvement cannot be certified from text logs alone.
- Vobiz documentation endpoints attempted were unavailable through the research tool. Protocol conclusions below use its official code example, not a claim that all Vobiz docs were read.

## Scorecard

| Area | Rating | Assessment |
|---|---|---|
| Primary model selection | Good | No evidence that replacing Sarvam conversations or Sonic alone fixes these failures. |
| Turn IDs and cancellation groundwork | Good foundation | Useful protections exist; cancellation and completion are not yet uniform across all stages. |
| Short replies / interruption | Needs change immediately | Meaningful short talk-over can be discarded. |
| Playback-aware conversation history | Needs change immediately | Receipts exist, but interrupted long jobs lose heard content. |
| LLM completion / stall recovery | Needs change immediately | Midstream hangs and unsuccessful repair are not modeled correctly. |
| STT failure handling | Needs change immediately | Fatal events and auth/quota failures need distinct transitions. |
| KB retrieval | Basic | Bounded lookup exists; stale results are not sufficiently tied to the current question. |
| Generic webhook tools | Needs change immediately | Retried writes can duplicate external effects. |
| Tool result reporting | Basic | Error strings can produce success telemetry. |
| Noise processing | Basic | Bandpass filtering, not a denoiser or echo canceller. |
| Multi-replica call ownership | Needs change immediately | Local maps are insufficient for distributed admission and duplicate protection. |
| Deployment lifecycle | Needs change immediately | Shutdown finalizes active calls immediately rather than draining them. |
| Load/backpressure behavior | Needs validation and changes before scale | Several queues and worker failure paths are not bounded safely. |

No component is labeled “perfect”: that would require invariant tests, recordings, failure injection and measured production behavior.

## Findings

### F01 — P1: short meaningful interruptions can be discarded

Evidence: [interruption policy](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/interruption-manager.ts:141) and [final-transcript discard branch](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/pipeline.ts:4387).

While processing a response and playing audio, the false-interruption rule relies on a word-count floor. Outside the special short-reply/coalescing exceptions, the pipeline returns and discards the caller's finalized transcript.

The actual helper classified “No thanks”, “Not interested” and “I am busy” as false interruptions under the tested speaking/default-floor conditions. “stop” was accepted. This is not a claim that every short reply or stop request is currently lost.

**Change:** distinguish backchannels from meaningful caller intent; do not equate few words with noise. Keep low-confidence fragments pending with a deadline instead of silently deleting a completed rejection/correction. Preserve explicit stop/cancel priority.

**Acceptance:** test affirmative, negative, correction, refusal, stop, names and numbers during greeting, speech, a tool call and final audio tail, in Tamil, English and code-mixed speech. Each meaningful utterance must appear exactly once in turn history.

### F02 — P1: an interrupted Cartesia job can lose already-heard text from history

Evidence: [heard-text selection](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/pipeline.ts:1649) and [job receipt accounting](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/pipeline.ts:6915).

When carrier receipt mode is enabled, heard-text selection returns only completed job text. A Cartesia continuation job can represent a long response; the checkpoint is awaited after that job drains. Interrupting before its completion can leave no completed text even though the caller heard several seconds.

The actual method returned an empty string with an active, partly played sentence and no completed receipt-backed sentences. The method is conservatively avoiding invented delivery, but its accounting granularity loses useful history.

**Change:** maintain a per-turn record of generated text, submitted text, audio sample offsets, carrier-confirmed playback and uncertain delivery. Use timestamp-aligned text and bounded phrase checkpoints. Do not replace carrier evidence with an assumption that locally sent audio was heard.

**Acceptance:** interrupt at multiple word boundaries; history must retain the confirmed spoken prefix, exclude the unheard suffix, and never carry old-turn audio into the next turn.

### F03 — P1: generic webhook POST retries can duplicate external actions

Evidence: [webhook invocation](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/services/tool-executor.ts:1930) and [method-agnostic retries](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/lib/ssrf.ts:136).

Generic webhooks pass `retries: 1` for POST as well as GET. The helper retries selected HTTP errors/network failures without requiring an idempotent operation. A remote system can apply a write and then return 503 or lose the response; the second attempt can apply it again. A call ID alone does not distinguish separate tool invocations.

The isolated check returned 503 then 200 and recorded **two POST attempts**.

**Change:** disable automatic retries for non-idempotent writes by default. For integrations supporting idempotency, persist one invocation ID and reuse it across retries. Record uncertain outcomes separately from confirmed failures. Native booking dedupe does not protect arbitrary external webhook implementations.

**Acceptance:** simulate “write committed, response lost”; exactly one external effect occurs, or the result is marked uncertain without a blind retry.

### F04 — P1: concurrent-call admission and duplicate protection are process-local

Evidence: [per-user count](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/session.ts:321), [Vobiz in-flight sets](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/telephony/vobiz.ts:13), and [Redis session mirror](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/sessionStore.ts:1).

Admission counts local session objects, with asynchronous setup before registration. Different starts can both pass the count before either is registered. Multiple replicas also see independent counts and duplicate-start sets. Redis metadata mirroring is not an atomic admission reservation.

**Change:** atomically reserve capacity and call ownership before setup, using a shared store. Include tenant scope, carrier call/leg identity, expiring leases, owner heartbeat and fencing. Release reservations on every failed setup and terminal path. Define behavior during shared-store failure.

**Acceptance:** start the same call on two replicas and submit parallel calls at the tenant limit. There must be one owner and no over-admission. Kill the owner and verify bounded lease recovery without replaying tools.

### F05 — P1: a deployment terminates existing calls instead of draining them

Evidence: [shutdown handler](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/index.ts:588), especially the `endSession(..., "server_shutdown")` loop at line 619.

Stopping new HTTP connections is followed immediately by finalizing all active sessions. Draining outbound HTTP afterward cannot restore the calls that have already ended. The process also has a short forced-exit deadline.

**Change:** separate draining from terminating. Mark the instance unready, reject new call admission, retain established call transports and allow calls to finish within an explicit maximum drain window. Coordinate the window with Railway/Kubernetes termination settings and load-balancer behavior. Preserve finalization as the final fallback, not the first action.

**Acceptance:** deploy during an active call. The old instance serves that call until completion, the new instance accepts new calls, and accounting/recording finalize once. Test forced termination separately; no system can guarantee survival after an unconditional process kill.

### F06 — P1: Sarvam streaming lacks a post-header no-progress deadline

Evidence: [header-only timer](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/adapters/llm/sarvam.ts:520), timer clearing at line 589, and the blocking reader at line 732.

The connection timer is removed when response headers arrive. A body that emits some tokens and then remains open without progress is not covered by that timer. EOF repair only runs after EOF, so it cannot repair a stream that never ends. The optional first-token fallback is not an inter-token watchdog.

**Change:** introduce first-token, inter-token idle and overall response budgets under the turn's abort scope. Distinguish a stalled stream from a completed response. After speech has been delivered, recovery must not replay the entire answer.

**Acceptance:** inject headers-only, partial-then-stall, malformed SSE, abrupt EOF and cancellation during read. Every case must terminate or recover within its deadline without double completion.

### F07 — P1: failed incomplete-response repair still reports normal completion

Evidence: [repair handling](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/adapters/llm/sarvam.ts:765), normal `onDone` at line 908, and [completion tests](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/adapters/llm/sarvam-completion.test.ts:1).

The recent patch detects some incomplete streams and attempts one bounded repair. If repair times out, rewrites the prefix, or fails, the original cut-off text survives and the adapter still invokes normal completion. An existing test explicitly keeps a truncated prefix when a rewritten repair is rejected.

**Change:** return a typed outcome such as completed, truncated, failed or cancelled. Propagate it to pipeline history and telemetry. Define a safe audible recovery policy without falsely implying that the answer completed or that a tool succeeded. Consider a small bounded text tail where needed, with its latency cost measured.

**Acceptance:** repair timeout/rewrite cannot produce a successful-completion event. Recovery adds no duplicated speech, fabricated action or dangling old-turn suffix.

This is a remaining gap in the last fix, not evidence that the earlier fragmentation and cancellation fixes did nothing.

### F08 — P1: Sarvam fatal STT errors and fallback reasons are conflated

Evidence: [fatal error branch](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/adapters/stt/sarvam-realtime.ts:562) and [close handling](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/adapters/stt/sarvam-realtime.ts:702).

A fatal error after session startup is logged but does not itself invoke the dead-connection path; that depends on a subsequent socket-close event. Before startup, close code 1003 is grouped with capability/configuration failure and triggers legacy fallback.

Sarvam documents distinct auth/quota, inactivity, internal and configuration failures. They should not all become an implicit API downgrade. [Sarvam realtime protocol](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming).

**Change:** map fatal events directly to an idempotent lifecycle transition. Classify retryable faults, quota/auth failures and unsupported capabilities separately. Log requested and effective provider/model/endpoint and the fallback reason.

**Acceptance:** fatal-without-close cannot leave a live-looking dead stream. Auth/quota failures do not silently downgrade. Recovery is bounded and does not create overlapping STT sessions.

### F09 — P1 before scale-up: missing queue bounds and worker recovery

Evidence: [audio worker pending jobs](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/audioPool.ts:62), [TTS PCM producer](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/pipeline.ts:7109), [PCM drain/accounting](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/pipeline.ts:7381) and [Vobiz audio sender](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/telephony/vobiz.ts:161).

The worker pending map has no per-request deadline or queue limit; worker errors clear current jobs but do not establish a replacement worker lifecycle. TTS jobs retain consumed PCM buffers while using an advancing index, and remaining-byte accounting scans queued blocks repeatedly. The Vobiz sender does not enforce a socket-buffer high-water mark.

These are load/failure risks, not proof that call 24710 suffered a memory exhaustion event. Other input buffers already have bounds; the issue is inconsistent coverage.

**Change:** bound every queue in milliseconds/bytes, release consumed buffers, maintain byte counters, detect transport backlog and define an overload response. Add worker exit handling, health state, deadlines and controlled replacement. Reinitialize stateful audio processing deliberately after a worker failure.

**Acceptance:** slow the carrier, stall/kill an audio worker and burst TTS generation. Memory remains bounded, no promise waits forever, and overload is explicit rather than accumulating seconds of stale audio.

### Additional findings and limitations

| ID | Priority / confidence | Evidence | Required change |
|---|---|---|---|
| F10 | P2, reproduced | [text remainder helper](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/cartesia-token-coalesce.ts:40) returned `" world!"` for sent `"Hello, world!"` versus final `"Hello world!"`. Longest-common-prefix fallback can repeat an already-spoken suffix after normalization differs. | Use one canonical text stream with stable offsets. A prefix mismatch must not automatically authorize suffix replay. |
| F11 | P2, provider-contract risk | [Cartesia context close](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts:879) omits settings included by [continuations](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts:914); continuation settings are rebuilt from mutable adapter state. | Capture immutable settings per context and consistently reuse them. Verify the exact outgoing payloads against provider behavior. No observed provider rejection is claimed. |
| F12 | P2, confirmed code path | [late and stale KB fallback](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/pipeline.ts:9438) lets older asynchronous results overwrite newer cache state, and reuses old context for empty lookups without checking whether the question changed. | Scope results to query/topic, source revision and turn generation. Distinguish no-hit from timeout. Ignore superseded results; do not inject unrelated passages. |
| F13 | P2, reproduced | [tool response logging](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/pipeline.ts:7725) reports success for a returned `"error: webhook tool failed to execute"`. | Structured tool outcomes, not error-bearing success strings. Propagate cancelled, failed and uncertain states to the LLM and metrics. |
| F14 | P2, hardcoded configuration | [global Sarvam hints](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/adapters/stt/sarvam-realtime.ts:51) prepends B2B, travel, booking and CRM terms for every agent. | Make domain hints agent-specific and allow an empty set. Irrelevant hints are a recognition-bias risk, not proof of a particular mistranscription. |
| F15 | P2, capability limitation | [NoiseCanceller](/private/tmp/voiceorch-fix.2rQqtK/repo/artifacts/api-server/src/orchestration/audio.ts:330) implements a bandpass only. The old RMS gate is no longer active here. | Label the feature accurately. Evaluate actual denoising and echo-control options against recordings; do not claim a bandpass removes overlapping speech or in-band noise. |

## Comparison with Pipecat

This is a comparison of contracts and architecture, not a benchmark or a claim that a framework migration automatically fixes the application.

| Concern | Pipecat reference pattern | Voiceorch direction |
|---|---|---|
| Turn boundaries | Explicit start/stop strategies and transcript-aware completion deadlines. | One owner of turn completion; separate detecting speech, committing a turn and interrupting playback. |
| Cancellation | Interruption is a pipeline event that invalidates pending work. | A single turn generation and abort scope must govern LLM, TTS, queued audio and late callbacks. |
| Assistant history | Assistant aggregation follows output; TTS text/timestamps support alignment with spoken output. | Add granular playback accounting; keep Vobiz receipts as stronger delivery evidence. |
| Tool lifecycle | Explicit function lifecycle and interruption policy. | Typed outcomes, deadlines, read/write cancellation policy and durable idempotency for writes. |
| Muting | Configurable policies, not a universal rule that greeting speech must be ignored. | Short rejection/stop commands must survive all greeting and playback states. |
| Distributed operations | Framework pipeline abstractions do not replace application admission, durable writes or deployment policy. | Fix shared ownership, quotas and graceful draining even if adopting Pipecat. |

The turn/completion comparison comes from [Pipecat turn strategies](https://docs.pipecat.ai/api-reference/server/utilities/turn-management/user-turn-strategies); output/history placement from [context management](https://docs.pipecat.ai/pipecat/learn/context-management); cancellation from [system frames](https://docs.pipecat.ai/api-reference/server/frames/system-frames); tool lifecycle from [function calling](https://docs.pipecat.ai/pipecat/learn/function-calling); and mute policy from [user mute strategies](https://docs.pipecat.ai/api-reference/server/utilities/turn-management/user-mute-strategies).

Pipecat also supports minimum-word interruption rules; copying those settings can reproduce short-reply loss. Sarvam's Pipecat integration has its own coalescing and reconnection caveats. Adopt the contracts and tests, not arbitrary defaults copied across different transports. [Sarvam Pipecat production guide](https://docs.sarvam.ai/api/integration/pipecat-production-guide).

## Provider configuration assessment

### Sarvam conversations

`sarvam-105b-conversations` is specifically intended for real-time dialogue. There is no basis here for blaming the 105B model choice alone. Keep reasoning disabled where applicable for the voice path, verify token budgets, and record the effective request configuration. The priority fixes are streaming deadlines and truthful completion status. [Sarvam model documentation](https://docs.sarvam.ai/api/getting-started/models/sarvam-105b).

### Sarvam STT

The realtime adapter defaults to fast mode, which is aligned with voice use. Realtime and legacy streaming are not interchangeable. Verify the effective model, sample rate, input encoding and endpointing mode at session start. Manual flush belongs to manual endpointing; VAD mode owns its provider-side endpoint. Avoid adding independent fallback waits after a final result is already available. [Sarvam realtime documentation](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming).

Session configuration already calls a shared Sarvam endpointing resolver. That is useful groundwork, not proof that every later fragment/semantic timer has consistent ownership.

### Cartesia Sonic 3.5 and 3.6

Both documented model families support Tamil. Production comparisons should pin a dated model version, a voice and all generation settings; changing a floating alias and orchestration together makes regression attribution difficult. There is no evidence here that merely switching 3.5 to 3.6 resolves playback bugs. [Sonic 3.5](https://docs.cartesia.ai/build-with-cartesia/tts-models/sonic-3-5), [Sonic 3.6](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest).

Using a shared continuation context is appropriate for prosody. Cartesia requires context settings to remain consistent; an empty final transcript is allowed. Expired contexts must not be reused. F11 is about inconsistent request settings, not a blanket claim that empty closure is invalid. [Contexts and continuations](https://docs.cartesia.ai/use-the-api/tts-websocket/contexts).

Managed buffering at 3,000 ms is not necessarily a fixed three-second latency penalty. Do not arbitrarily lower it to “fix latency.” Preserve whitespace and complete sentence punctuation; test normal endings and interrupted endings separately. The current raw tail flush does not guarantee a well-formed final sentence. [Continuation guidance](https://docs.cartesia.ai/build-with-cartesia/capability-guides/stream-inputs-using-continuations).

### Vobiz

Playback acknowledgements are now used; saying they are entirely absent would be incorrect. The remaining weakness is their granularity and use in history. Vobiz's official sample demonstrates checkpoint → playedStream and clearAudio/clearedAudio. A successful local socket send is not a playback acknowledgement. [Official Vobiz streaming example](https://github.com/vobiz-ai/Vobiz-Python-Voice-API-Example).

No verified evidence establishes an 8-kHz PCM byte-order mismatch in this call path. Do not change codec/sample rate speculatively.

## What call 24710 actually established

| Measurement | Observed |
|---|---:|
| Answer to first audio | About 3,954 ms |
| Setup before the pipeline's measured first-audio interval | About 2,886 ms |
| Pipeline interval to first audio | About 1,068 ms |
| Greeting LLM latency | About 902 ms |
| Greeting TTS first byte | About 156 ms |
| Later LLM first-token samples | About 464 ms and 350 ms |

These spans are not all additive: the pipeline interval contains work such as LLM/TTS. The largest observed startup component was session setup, not the greeting's TTS first-byte time.

The log also showed an incomplete LLM ending and fragmented final TTS draining. The previous patch targeted those. Zero-audio continuation submissions were not automatically failed synthesis requests. There is no post-fix call here proving the new deployed behavior.

Next startup work should instrument agent/config DB reads, memory/KB reads, provider initialization, greeting generation and first carrier-confirmed playback separately. Move nonessential work off the first-audio path; use a cached/prebuilt greeting only when compatible with personalization and caller interruption. Measure cold and warm paths independently.

## Target design

A per-call session supervisor should own the transport, provider health and termination. A per-turn controller should own its transcript, generation ID, abort scope and deadlines. Supporting components should have narrow contracts:

1. Input/turn controller: provisional speech → committed transcript exactly once.
2. LLM controller: streamed text plus explicit completed/truncated/failed/cancelled outcome.
3. Speech/output controller: canonical text offsets → audio → carrier-confirmed played prefix.
4. Tool executor: invocation ID, typed result, deadline, idempotency and explicit side-effect policy.
5. KB retriever: query/source/turn-scoped results with relevance-aware fallback.
6. Shared admission service: atomic tenant capacity and fenced call ownership.

This can be introduced incrementally in the current TypeScript application. A wholesale Python/Pipecat rewrite would add migration risk and would still need the business and carrier contracts above.

## Release gates and priority order

### First: correctness and call preservation

Fix F01–F08 in small reviewed changes with regression tests. Include F13 with the tool work. Before routing a meaningful volume to multiple replicas, fix F04/F05/F09 and test rolling deployments. Do not turn on aggressive scale-in for active call workers until draining works.

### Next: conversation quality

Fix canonical speech accounting and F10/F11, then KB freshness and domain hints. Unify endpointing policy around measured provider finalization. Evaluate denoising using real Tamil/English/code-mixed phone recordings, not only clean microphone samples.

### Then: production verification

Require:

- Exactly one terminal result per turn and one terminal status per call.
- No stale-turn text/audio after interruption or cancellation.
- No silent loss of meaningful short replies.
- No duplicate external write on retry, reconnect or replica race.
- No successful-completion metric for truncated LLM output or failed tools.
- Bounded queues and deadlines under stalled providers and carrier backpressure.
- Stable memory/latency during sustained peak load.
- Confirmed deployment SHA and effective provider settings in every test call.
- Paired recordings and timestamps for the same scripted calls before/after changes.

### Capacity is concurrency, not only calls/day

For an illustrative workload of **30,000 connected calls/day, three minutes each**:

- Spread over 24 hours: **62.5 average concurrent calls**.
- Spread over 12 hours: **125 average concurrent calls**.
- Bursty campaigns can require substantially more than the average.

Those numbers are arithmetic assumptions, not measured capacity. Unanswered attempts and ringing need separate modeling. Three 8-vCPU nodes are not proven sufficient simply because the total is 30,000 calls/day. Benchmark CPU, memory, event-loop lag, queue age, provider concurrency/rate limits and call-start rate; include one-node loss and rollout headroom.

## Bottom line

The code has useful foundations and several earlier fixes are real. The critical remaining work is consistent orchestration: what counts as a turn, what actually played, what completed, who owns the call, and what happens on interruption or failure. Improve and test those invariants before changing model providers or declaring production readiness.
