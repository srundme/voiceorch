# Orchestration hardening — 13 September 2026

This batch addresses confirmed defects from the baseline audit. It does not certify a bug-free pipeline or 30,000 calls/day capacity. The additional call 24761/24730 attachment is an analyst's summary, not raw audio or a fresh deployed trace; its echo, language and incomplete-Tamil claims remain investigation leads.

## Implemented

| Area | Change |
|---|---|
| Caller interruptions | Meaningful short final replies are no longer classified as false interruptions merely for falling below the speculative word threshold. |
| Echo | Substantial matching phrases can be recognized in the short post-playback tail; completed continuation text is available to the matcher. Short genuine replies and stop overrides remain protected. |
| Playback evidence | Cartesia timestamps plus periodic carrier checkpoints preserve acknowledged word prefixes when long responses are interrupted. Missing timestamps never become guessed words. |
| Cartesia | Voice/language/generation parameters are stable within a context. Mismatched normalized text cannot trigger a replayed suffix. |
| Sarvam LLM | Post-header reads have a 15-second inactivity deadline and 120-second overall stream bound. Unsuccessful truncation repair is an error, not successful completion. Partial-output failure drains submitted audio and offers clarification rather than replaying or immediately ending the call. |
| Sarvam STT | Fatal events close and notify even after startup. Authentication/quota close code 1003 is not retried as a legacy URL. Unrelated hardcoded business hints are removed. |
| KB | A new question cannot silently inherit stale retrieval context; late results are fenced to their originating turn. |
| Tools | Generic unsafe HTTP methods are not automatically retried. Error-bearing tool strings produce error telemetry. Closed/interrupted calls do not restart tool-result speech. |
| Backpressure | Consumed PCM buffers are released, synthesis backlog is bounded, worker jobs time out, crashed workers have bounded restart attempts, and overloaded Vobiz sockets close instead of accumulating stale speech. |
| Admission | PostgreSQL transaction locks and expiring ownership leases replace local-only admission counting. Duplicate active identities have one owner; audio output is fenced after ownership loss. |
| Deployment | New calls are refused during shutdown while existing calls can finish for up to five minutes, followed by finalization. Both Railway configurations set a 320-second drain window. |
| Noise UI | Main agent screens describe the existing speech-band filter accurately; no claim of acoustic echo cancellation. |

## Rollout requirements

1. The production PostgreSQL role must be able to create the additive `voice_call_leases` table/index in its application schema, or an administrator must pre-create them from `call-admission.ts`. Admission fails closed if the shared reservation cannot be obtained. No production database was contacted by these tests.
2. All replicas must share that database. During the first rollout, old binaries do not hold leases: allow old calls to finish before treating distributed limits as enforced. This does not implement cross-replica callback routing, scheduler leadership, or recovery of a live audio stream after a host crash.
3. Confirm Railway used the correct config and accepted `deploy.drainingSeconds=320`. The default application `CALL_DRAIN_MS` is 300000. If increased, increase host grace accordingly. This cannot retroactively change shutdown behavior of an already running old binary. [Railway configuration reference](https://docs.railway.com/config-as-code/reference#draining-seconds).
4. After deployment, verify the active commit, health, first-call setup, Tamil and code-switched speech, stop/yes/no interruptions, long utterance playback and one controlled redeploy during a test call. A push alone is not evidence of deployment success.
5. Compare p50/p95 STT-to-first-LLM-token, first-TTS-byte, first-carrier-audio, playback underruns and false interruptions using actual recordings and traces. Validate peak concurrency and provider quotas before raising traffic.

## Verification and remaining limits

Final API suite: 1,536 tests passed across 175 files; three opt-in database tests skipped in that run. Those three PostgreSQL integration tests passed separately against a disposable local database, including 12 simultaneous reservations at a limit of three, duplicate ownership and local expiry fencing. API production bundle builds successfully. The disposable database was stopped after verification.

Type checking still reports pre-existing failures in LLM tool-choice declarations, endpointing and several routes. The local dashboard build could not run because its Vite dependency is absent; changes there are text labels only. No successful dashboard build is claimed.

Still required: actual denoising/AEC with a reference signal and audio evaluation; validation of the configured multilingual voice and backchannel language; durable idempotency/outcome tracking for external tool writes; turn-generation fencing across every asynchronous tool path; end-to-end multi-replica/load/failure tests. A 15-second SSE read timeout does not distinguish heartbeats from useful tokens, though the overall stream deadline bounds both. Carrier timestamps/checkpoints are conservatively sampled, not sample-perfect knowledge of what a person heard. Do not mute all inbound speech during TTS to hide echo.

Rollback: redeploy the prior revision using the normal deployment workflow; the additive lease table can remain. Do not delete production call data or reset Git history.
