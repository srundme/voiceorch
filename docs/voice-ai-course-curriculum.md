# Building a Voice AI Agent Orchestration Platform — Code-Grounded Course Curriculum

> A low-level, implementation-first course built entirely on the **VoiceOrch** codebase (a Bolna-inspired AI voice-agent orchestrator). Every topic points at the exact file and function in this repository that demonstrates it. This is the curriculum/outline only — not the lessons themselves.

---

## Course Overview

### Who this is for
- **Full-stack & backend engineers** who want to build real-time, telephony-grade voice systems rather than chatbot demos.
- **AI/ML engineers** who want to wire ASR → LLM → TTS into a low-latency, interruptible conversation loop with tool calling.
- **Agency owners / technical founders** building a multi-tenant Voice-AI SaaS where customers bring their own provider keys.

### What you'll be able to build by the end
A production-grade, multi-tenant voice agent platform that can:
- Answer and place phone calls over **Twilio, Plivo, and VoBiz**, plus in-browser **WebRTC web calls**.
- Run a real-time **STT → LLM → TTS pipeline** with streaming transcription, barge-in (interruption), VAD, noise cancellation, and ambient audio.
- Let the LLM **call tools mid-conversation** (book/reschedule/cancel appointments, hit external webhooks, transfer the call).
- Run a full **multi-tenant scheduling engine** with availability rules, advisory-locked slot booking, Google Calendar sync, email, and webhooks.
- Handle **authentication** (standalone Google OAuth + JWT sessions), **encrypted provider key storage**, **usage metering/billing**, and **multi-environment deployment** on Replit.

### Global prerequisites
- Strong **TypeScript** and **Node.js** (async, streams, `Buffer`, `worker_threads`).
- Comfort with **HTTP, WebSockets, and REST**; basic audio concepts (PCM, sample rate, codecs) are taught in Module 2.
- **PostgreSQL** + an ORM (we use Drizzle); SQL transactions and locking help.
- A working **monorepo** mindset — this repo is a pnpm workspace (see the `pnpm-workspace` skill and `replit.md`).

### How the codebase is organized (orientation)
- `artifacts/api-server/` — the Express backend (orchestration, routes, services).
- `artifacts/dashboard/`, `artifacts/admin/` — React + Vite frontends.
- `lib/db/` — Drizzle schema and DB client.
- `lib/api-spec/` — OpenAPI source of truth + Orval codegen config.
- `lib/api-zod/`, `lib/api-client-react/` — **generated** Zod schemas and React Query hooks.
- `replit.md` — project README and architecture decisions.

---

## Suggested Learning Path & Module Ordering

The course builds in seven phases: **Foundations → Audio → Pipeline → Orchestration/Tools → Scheduling/Integrations → Platform/Infra → Testing/Scaling.**

| # | Module | Phase | Duration |
|---|--------|-------|----------|
| 1 | Architecture & the Contract-First Monorepo | Foundations | 3h |
| 2 | Audio Engineering for Telephony | Audio | 5h |
| 3 | Telephony Transport: Twilio, Plivo, VoBiz & Web Calls | Audio | 5h |
| 4 | Provider Adapters: ASR, LLM, TTS | Pipeline | 5h |
| 5 | The Real-Time Orchestration Pipeline | Pipeline | 7h |
| 6 | Session Lifecycle, State & Cross-Call Memory | Pipeline | 5h |
| 7 | LLM Tool Calling During Live Calls | Orchestration | 6h |
| 8 | Prompt Engineering for Voice Agents | Orchestration | 4h |
| 9 | Database Schema Design with Drizzle | Platform | 4h |
| 10 | The Scheduling Engine & Slot Computation | Scheduling | 6h |
| 11 | Concurrency & Race Prevention (Advisory Locks) | Scheduling | 4h |
| 12 | Google Calendar & SaaS-Style OAuth | Integrations | 5h |
| 13 | Webhooks: Inbound Telephony & Outbound Event Dispatch | Integrations | 5h |
| 14 | Authentication, Sessions & Encryption | Platform | 5h |
| 15 | Provider Key Management & Multi-Tenancy | Platform | 4h |
| 16 | API Design: OpenAPI → Codegen → Typed Hooks & Zod | Platform | 5h |
| 17 | Usage Metering, Billing & Alerting | Platform | 4h |
| 18 | Testing & Debugging Voice AI Systems | Testing | 4h |
| 19 | Multi-Environment Deployment on Replit | Infra | 4h |

**Total estimated course length: ~90 hours** of guided content + hands-on builds (≈ a 10–12 week part-time program).

---

## Module 1 — Architecture & the Contract-First Monorepo
**Objective:** Understand the end-to-end system and the contract-first workflow before writing any feature code.

**Topics & code references:**
- The big picture: read the architecture decisions and product map in `replit.md`.
- Monorepo layout: workspaces in `pnpm-workspace.yaml`; artifacts vs. libs (`artifacts/api-server`, `lib/db`, `lib/api-spec`).
- The contract-first loop: `lib/api-spec/openapi.yaml` (source of truth) → `lib/api-spec/orval.config.ts` (codegen) → generated `lib/api-client-react/src/generated/api.ts` + `lib/api-zod/src/generated/api.ts`.
- Express app & route aggregation: `artifacts/api-server/src/routes/index.ts` (`router.use(...)` mounting all sub-routers).
- Server logging convention (never `console.log`): `artifacts/api-server/src/lib/logger.ts`.

**Prerequisites:** Global prerequisites only.

**Hands-on project:** Stand up the repo, run a typecheck (`pnpm run typecheck`), trace one endpoint from `openapi.yaml` → generated hook → Express handler, and add a trivial `GET /api/meta/ping` route end-to-end (spec → codegen → handler) without breaking the typecheck.

---

## Module 2 — Audio Engineering for Telephony
**Objective:** Master the low-level audio math that makes phone-grade voice possible.

**Topics & code references:**
- μ-law (G.711 PCMU) codec: `mulawToLinear` / `linearToMulaw` / `decodeMulaw` / `encodeMulaw` in `artifacts/api-server/src/orchestration/audio.ts`.
- Resampling: `upsample8to16` and the anti-aliased `downsample16to8` in `audio.ts`.
- Voice Activity Detection: `hasSpeechEnergy` (RMS energy gate) in `audio.ts`.
- Noise cancellation: the `NoiseCanceller` class (Butterworth bandpass + adaptive noise gate) in `audio.ts`.
- Pitch estimation (for gender detection): `estimatePitch` (autocorrelation + octave-error correction) in `audio.ts`.
- WAV packaging: `pcmToWav` in `audio.ts`.
- DTMF tone detection: the `DtmfDetector` class + Goertzel algorithm (`makeCoeff`, `goertzelPower`) in `artifacts/api-server/src/orchestration/dtmf.ts`.

**Prerequisites:** Module 1; comfort with `Buffer`/typed arrays.

**Hands-on project:** Write a CLI that ingests a raw 8 kHz μ-law file, decodes it, runs `NoiseCanceller` + `hasSpeechEnergy`, and emits a stereo WAV — verifying byte counts at each stage.

---

## Module 3 — Telephony Transport: Twilio, Plivo, VoBiz & Web Calls
**Objective:** Bridge live phone/browser audio into the pipeline over WebSockets.

**Topics & code references:**
- Twilio Media Streams handler: `handleTwilioWebSocket` + TwiML generator `getTwilioVoiceTwiML` in `artifacts/api-server/src/orchestration/telephony/twilio.ts`.
- Plivo AudioSocket handler: `handlePlivoWebSocket` + `getPlivoAnswerXML`, including the `clear` barge-in message in `telephony/plivo.ts`.
- VoBiz raw-PCM transport: `artifacts/api-server/src/orchestration/telephony/vobiz.ts`.
- In-browser web calls: `handleWebCallWebSocket` (echo-cancellation-aware barge-in, PCM amplification `amplifyPcm`, tail-silence padding) in `telephony/webcall.ts`.
- Outbound dialing: `dialTwilio` / `dialPlivo` / `dialVobiz` in `telephony/dial.ts`.
- Call transfer (cold + warm/whisper): `transferTwilioCall`, `transferPlivoCall`, `transferVobizCall`, and XML builders in `telephony/transfer.ts`.
- **Critical gotcha:** the webcall path is a *separate* implementation from the pipeline — features must be duplicated (see `.agents/memory/webcall-pipeline-split.md` reasoning, mirrored in `webcall.ts` vs `pipeline.ts`).

**Prerequisites:** Module 2; WebSocket basics.

**Hands-on project:** Implement a minimal Twilio Media Streams echo server using `handleTwilioWebSocket` as a template: accept the `start`/`media` events, decode inbound μ-law, and stream it back out as `media` frames.

---

## Module 4 — Provider Adapters: ASR, LLM, TTS
**Objective:** Build a pluggable, multi-provider adapter layer with a single unified interface.

**Topics & code references:**
- STT factory: `createSTTAdapter` in `artifacts/api-server/src/orchestration/adapters/stt/index.ts`; the `STTAdapter` interface in `adapters/stt/base.ts`; streaming vs batch (`DeepgramSTT` in `adapters/stt/deepgram.ts`, plus `azure.ts`, `assemblyai.ts`, `sarvam.ts`, `cartesia.ts`).
- LLM factory: `createLLMAdapter` in `adapters/llm/index.ts`; provider classes `OpenAILLM`, `AnthropicLLM`, `GroqLLM`, `GoogleLLM`, `DeepSeekLLM`, `MistralLLM`, `CohereLLM`, `QwenLLM`, `SarvamLLM` (the `LLMAdapter` interface lives in `orchestration/types.ts`).
- TTS factory: `createTTSAdapter` in `adapters/tts/index.ts`; `ElevenLabsTTS`, `CartesiaTTS`, `OpenAITTS`, `AzureTTS`, `DeepgramTTS`, `SarvamTTS`.
- Streaming token/audio callbacks: the `chat(...)` streaming-delta pattern in `adapters/llm/openai.ts` and `adapters/llm/anthropic.ts`.
- Per-provider usage reporting via the `onUsage` callback (consumed by the pipeline).

**Prerequisites:** Module 1; SSE/streaming HTTP basics.

**Hands-on project:** Add a new mock LLM adapter (`EchoLLM`) implementing the `LLMAdapter` interface, register it in `createLLMAdapter`, and prove it streams tokens through the existing `chat(...)` callback signature.

---

## Module 5 — The Real-Time Orchestration Pipeline
**Objective:** Assemble the core STT → LLM → TTS loop with interruption and pacing.

**Topics & code references:**
- The `OrchestrationPipeline` class in `artifacts/api-server/src/orchestration/pipeline.ts`.
- Audio ingress: `onAudioIn` (μ-law) / `onRawPcm8kIn` (PCM) → `handleProcessedAudio`.
- Streaming STT lifecycle with backoff reconnect: `initStreamingSTT`, `handleStreamingTranscript`.
- The turn loop: `processTurn` (RAG context, LLM chat, tool dispatch, TTS) and `playSentence`.
- Greeting + IVR pre-filter: `greet()`.
- Barge-in tuning constants & logic: `BARGE_IN_ENERGY_THRESHOLD`, `BARGE_IN_ECHO_GRACE_MS`, `wordsForInterruption` handling in `pipeline.ts`.
- Audio worker offloading: `processAudioIn` / `processRawPcm8kIn` / `destroyAudioSession` in `orchestration/audioPool.ts`, backed by `orchestration/audioWorker.ts` (consistent-hash routing by `callId`).
- Ambient noise mixing: `AmbientNoiseStream` / `FileAmbientNoiseStream` / `loadPcmLoop` in `orchestration/ambient.ts`.
- Call recording: `RecordingBuffer` in `orchestration/recorder.ts`.

**Prerequisites:** Modules 2–4.

**Hands-on project:** Build a reduced single-file pipeline that wires one STT, one LLM, and one TTS adapter into a `processTurn`-style loop driven by a fake audio source, and implement energy-based barge-in using `hasSpeechEnergy`.

---

## Module 6 — Session Lifecycle, State & Cross-Call Memory
**Objective:** Manage a call from creation to teardown, including durable state and caller memory.

**Topics & code references:**
- Session creation/teardown: `createSession`, `endSession`, `failSession`, and the in-process `sessions` map in `artifacts/api-server/src/orchestration/session.ts`.
- Agent config assembly: prompt variable resolution (`{{var}}`/`{var}`), KB injection, managed-key fallback in `session.ts`.
- Durable mirror: `saveSessionMeta`, `patchSessionMeta`, `saveConversation`, `removeSession` in `orchestration/sessionStore.ts` (Redis: `lib/redis.ts`).
- Cross-call memory: `loadCallerProfile`, `injectCallerMemory`, `updateCallerProfile`, `detectCallbackRequest` in `orchestration/callerMemory.ts`; persisted in `callerProfilesTable` (`lib/db/src/schema/callerProfiles.ts`).
- Date/time + strict-language injection into the system prompt (in `session.ts`); `orchestration/datetimeInject.ts`.
- Dropped-call vs natural-end detection (the `naturalEndTriggered` flag in `session.ts`).

**Prerequisites:** Module 5.

**Hands-on project:** Extend `createSession` to inject a custom `{{company}}` prompt variable from inbound call parameters and verify the resolved system prompt; then simulate a second call and confirm `injectCallerMemory` adds prior-call context.

---

## Module 7 — LLM Tool Calling During Live Calls
**Objective:** Let the model take real actions mid-conversation, safely.

**Topics & code references:**
- Tool schema generation (incl. auto-injected `end_call`): `buildToolDefs` in `artifacts/api-server/src/services/tool-executor.ts`.
- Native scheduling tools: `executeNativeBooking`, `executeNativeCheckAvailability`, `executeNativeReschedule`, `executeNativeCancel`, `executeNativeListBookings` in `tool-executor.ts`.
- Generic external action: `executeWebhookTool` in `tool-executor.ts`.
- Natural-language date parsing: `parsePreferredDate` in `tool-executor.ts`.
- Provider-side streaming tool-call parsing: `onToolCall` accumulation in `adapters/llm/openai.ts` (`delta.tool_calls`) and `adapters/llm/anthropic.ts` (`input_json_delta`).
- Where tools are dispatched in the loop: `processTurn` in `pipeline.ts` (and the duplicated path in `telephony/webcall.ts`).
- **Critical gotcha:** booking logic is triplicated (agent tool-executor, public routes, authed routes) — change all three (`.agents/memory/booking-path-triplication.md`).

**Prerequisites:** Modules 5–6; Module 10 helps for the booking tools.

**Hands-on project:** Add a new native tool `executeNativeGetWeather` (mocked) — define its schema in `buildToolDefs`, implement the executor, and confirm the OpenAI adapter streams a tool call that triggers it during a simulated turn.

---

## Module 8 — Prompt Engineering for Voice Agents
**Objective:** Engineer prompts that behave well in real-time speech, not just text.

**Topics & code references:**
- Effective system-prompt construction (date/time context, strict-language rule) in `createSession` (`session.ts`).
- Dynamic variables & precedence (system < agent defaults < campaign lead < inbound params) in `session.ts`.
- Knowledge-base context injection (FTS retrieval): `retrieveKbContext` in `orchestration/kb-retrieval.ts`; tables `knowledgeSourcesTable`/`knowledgeEntriesTable` in `lib/db/src/schema/knowledge.ts` (see `.agents/memory/kb-fts-architecture.md`).
- Caller-memory injection into the prompt: `injectCallerMemory` in `callerMemory.ts`.
- Reusable prompt templates: `artifacts/api-server/src/services/prompt-template.ts` and routes `routes/admin-prompt-templates.ts`.
- Speech-shaping behaviors: backchanneling phrases & handoff-phrase detection constants in `pipeline.ts` / `webcall.ts`.

**Prerequisites:** Modules 5–7.

**Hands-on project:** Design a system prompt + variable set for a clinic-receptionist agent that uses KB injection and `{{caller_salutation}}`, then trace exactly how `session.ts` resolves each placeholder at runtime.

---

## Module 9 — Database Schema Design with Drizzle
**Objective:** Model a multi-tenant voice platform with type-safe schema.

**Topics & code references:**
- Drizzle table pattern (`pgTable`, `$inferSelect`/`$inferInsert`, `createInsertSchema`) — start with `lib/db/src/schema/agents.ts`.
- Core tables: `callsTable` (`schema/calls.ts`), `providersTable` (`schema/providers.ts`), `usersTable` + `walletTransactionsTable` (`schema/users.ts`).
- JSONB-typed config columns: `agentConfig`/`tools` in `agents.ts` with `$type<...>()` casting.
- Scheduling tables (six): `schema/scheduling.ts` (`schedulingCalendarsTable`, `eventTypesTable`, `availabilitySchedulesTable`, `availabilityOverridesTable`, `bookingsTable`, `googleCalendarConnectionsTable`).
- Usage/billing: `usageEventsTable` (`schema/usage-events.ts`); K-V config `platformSettingsTable` (`schema/platform-settings.ts`).
- Barrel exports: `lib/db/src/schema/index.ts` (`export * from ...`).
- **Critical gotcha:** drizzle-kit push pitfalls (FK names >63 chars loop forever; raw-SQL-only columns drift) — see `.agents/memory/drizzle-push-gotchas.md`. Push command: `pnpm --filter @workspace/db run push`.

**Prerequisites:** Module 1; SQL fundamentals.

**Hands-on project:** Add a `call_tags` table with an FK to `callsTable`, generate its insert schema with `createInsertSchema`, export it from `index.ts`, run `typecheck:libs`, and push it — deliberately reproducing and fixing the long-FK-name gotcha.

---

## Module 10 — The Scheduling Engine & Slot Computation
**Objective:** Compute bookable time slots from weekly rules, overrides, and existing bookings.

**Topics & code references:**
- Slot generation: `getAvailableSlots` and the `TimeSlot` interface in `artifacts/api-server/src/services/scheduling/slot-engine.ts`; single-slot check `isSlotAvailable`.
- Inputs: weekly schedules (`availabilitySchedulesTable`), date overrides (`availabilityOverridesTable`), buffers (`bufferBeforeMins`/`bufferAfterMins`), capacity (`maxBookingsPerSlot`) — all from `schema/scheduling.ts`.
- Timezone correctness with `date-fns-tz` (used throughout `slot-engine.ts`).
- Scheduling route surface: `routes/scheduling/calendars.ts`, `availability.ts`, `event-types.ts`, `slots.ts`, `bookings.ts`, aggregated in `routes/scheduling/index.ts`.
- Public booking flow: `GET /api/scheduling/public/slots`, `POST /api/scheduling/public/bookings` in `routes/scheduling/public.ts`; self-service tokens via `issueToken`/`verifyToken` in `services/scheduling/booking-tokens.ts`.

**Prerequisites:** Module 9; timezone/date handling.

**Hands-on project:** Configure an event type with a 2-day weekly schedule, a buffer, and one blocking override, then call `getAvailableSlots` for a week and assert the exact slots returned across a DST boundary.

---

## Module 11 — Concurrency & Race Prevention (Advisory Locks)
**Objective:** Guarantee no double-booking under concurrent load.

**Topics & code references:**
- PostgreSQL advisory locks: `tryAdvisoryLock` (`pg_try_advisory_xact_lock`) and the deterministic key builder `buildSlotLockKey` in `artifacts/api-server/src/services/scheduling/lock.ts`.
- Lock-inside-transaction usage during booking: `executeNativeBooking` in `services/tool-executor.ts` and the booking write paths in `routes/scheduling/public.ts` / `routes/scheduling/bookings.ts`.
- Re-check availability *after* acquiring the lock (`isSlotAvailable`) before committing.
- Per-user concurrency control in web calls: the `activeCalls` map + `MAX_CONCURRENT_CALLS` in `orchestration/telephony/webcall.ts`.

**Prerequisites:** Module 10; SQL transactions.

**Hands-on project:** Write a concurrency test that fires N parallel booking requests for the same slot and asserts exactly one succeeds — using `buildSlotLockKey` + `tryAdvisoryLock` inside a transaction.

---

## Module 12 — Google Calendar & SaaS-Style OAuth
**Objective:** Connect end-user Google accounts with one platform-owned OAuth app.

**Topics & code references:**
- Platform OAuth client + URLs: `makePlatformOAuth2Client`, `getAuthUrl`, `exchangeCode` in `artifacts/api-server/src/services/scheduling/google-calendar.ts`.
- Token storage & auto-refresh: `upsertConnection`, `getValidAccessToken` (encrypted at rest via `encryptKey`/`decryptKey`).
- Calendar operations: `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent`, `fetchGcalBusyPeriods` (freebusy used by the slot engine).
- Connection management: `listConnectionsForUser`, `revokeConnection`, `getFirstConnectionForUser`; error classification `classifyGcalError`.
- OAuth routes (no-auth callback using `state`): `GET /api/scheduling/google/connect`, `GET /api/scheduling/google/callback`, `DELETE /api/scheduling/google/connections/:id` in `routes/scheduling/google-oauth.ts`; calendar↔connection mapping `PATCH /api/scheduling/calendars/:id/google-connection` in `routes/scheduling/calendars.ts`.
- Connection storage: `googleCalendarConnectionsTable` in `schema/scheduling.ts`.

**Prerequisites:** Modules 10 & 14 (OAuth/JWT concepts); read the `integrations` skill for credential handling.

**Hands-on project:** Implement the connect→callback→`upsertConnection` round trip against a test Google project, then create and delete a calendar event via `createCalendarEvent` / `deleteCalendarEvent`.

---

## Module 13 — Webhooks: Inbound Telephony & Outbound Event Dispatch
**Objective:** Both *receive* provider instructions and *emit* signed events to customers.

**Topics & code references:**
- Inbound telephony webhooks (return TwiML/XML): `routes/webhooks.ts` — e.g. `POST /api/webhooks/twilio/voice`, `POST /api/webhooks/vobiz/voice`, AMD handlers, and transfer/whisper XML endpoints.
- Universal lead intake (incl. Meta/Instagram Lead Ads): `POST /api/webhooks/lead/:token` with `flattenObject`/`extractLeadFields` in `routes/campaign-webhook.ts`.
- Outbound event dispatch + HMAC signing: `dispatchWebhooks` in `routes/webhook-endpoints.ts` (`createHmac("sha256", ...)`, `X-VoiceOrch-Signature` header) for `call.started`/`call.ended`/`call.failed`.
- Scheduling events: `dispatchSchedulingWebhooks` in `routes/scheduling/webhooks.ts` (`scheduling.booking.created/confirmed/cancelled/rescheduled`).
- Endpoint CRUD & secrets: `webhookEndpointsTable` (`schema/webhook-endpoints.ts`) managed via `routes/webhook-endpoints.ts`.

**Prerequisites:** Modules 3, 9, 10.

**Hands-on project:** Build a tiny receiver that verifies the `X-VoiceOrch-Signature` HMAC, register it via the webhook-endpoints API, trigger a `scheduling.booking.created` event, and confirm signature validation passes.

---

## Module 14 — Authentication, Sessions & Encryption
**Objective:** Implement standalone Google login, JWT sessions, and at-rest encryption.

**Topics & code references:**
- Login OAuth flow: `GET /api/auth/google/connect`, `GET /api/auth/google/callback` in `routes/auth.ts`; helpers `getLoginAuthUrl`/`exchangeLoginCode` in `services/auth/google-login.ts` (token delivered to SPA via `#session=<jwt>` fragment).
- JWT sessions (HS256): `createSessionToken`, `verifySessionToken` (`timingSafeEqual`), `extractRequestToken` in `lib/session.ts`; `SessionPayload` carries the Google `sub`.
- Middleware stack: `attachSession` (`middlewares/session.ts`) → sets `req.clerkUserId`; `requireAuth` (`middlewares/requireAuth.ts`); `requireAdmin` (`x-admin-token`, `middlewares/requireAdmin.ts`); first-login provisioning `provisionUser` (welcome credit + `apiKey`/`orgKey`) in `middlewares/userProvisioning.ts`.
- Clerk-compat shim: `getAuth(req)` in `lib/auth-compat.ts` (reads `req.clerkUserId`).
- Encryption: `encryptKey`/`decryptKey` (AES-256-GCM, `scryptSync` key from `APP_SECRET`, `enc:v1:` format with plaintext passthrough) in `lib/crypto.ts`.

**Prerequisites:** Module 1; HTTP auth basics. Consult the `environment-secrets` skill before touching secrets.

**Hands-on project:** Implement a protected `GET /api/account` route guarded by `attachSession` + `requireAuth`, and verify a tampered JWT is rejected by `verifySessionToken`.

---

## Module 15 — Provider Key Management & Multi-Tenancy
**Objective:** Let each tenant bring their own keys, with platform-managed fallback.

**Topics & code references:**
- Encrypted storage + last-4 masking: `POST/GET/PATCH /providers` and the `maskKey` helper in `routes/providers.ts` (`encryptKey` on write, `apiKeyHint` on read); `providersTable` in `schema/providers.ts`.
- Per-agent key scoping at call time: provider-key map construction in `createSession` (`session.ts`) and `handleWebCallWebSocket` (`webcall.ts`).
- Managed-key fallback model (BYOP vs managed): the `MANAGED` map (`managed_qwen_key`, etc.) + `platformSettingsTable` lookups in `session.ts` / `webcall.ts`.
- **Critical gotcha:** transient `platform_settings` keys must register via `registerTransientKey` (`services/rate-limit-cleanup.ts`) — see `replit.md` Gotchas.
- Migration note: pre-encryption keys are plaintext until re-saved (`decryptKey` passthrough), per `replit.md`.

**Prerequisites:** Modules 9 & 14.

**Hands-on project:** Add a new provider type end-to-end (schema enum → `routes/providers.ts` create/list → adapter factory), store an encrypted key, and confirm the list endpoint returns only the masked hint.

---

## Module 16 — API Design: OpenAPI → Codegen → Typed Hooks & Zod
**Objective:** Run a contract-first workflow that keeps client and server in lockstep.

**Topics & code references:**
- Source of truth: `lib/api-spec/openapi.yaml` (tags, `components/schemas`); **do not change `info.title: Api`** or generated paths break.
- Codegen config: `lib/api-spec/orval.config.ts` (two targets — `react-query` hooks + `zod` schemas; custom fetch mutator).
- Generated client hooks: `lib/api-client-react/src/generated/api.ts` (e.g. `useListAgents`, `useCreateAgent`) consumed by the dashboard/admin frontends.
- Generated server validators: `lib/api-zod/src/generated/api.ts` — used as `SomeBody.safeParse(req.body)` in routes (e.g. `routes/webhook-endpoints.ts`).
- The workflow command: `pnpm --filter @workspace/api-spec run codegen`, then `pnpm run typecheck:libs` (per `replit.md` Gotchas).

**Prerequisites:** Modules 1 & 9.

**Hands-on project:** Add a new endpoint to `openapi.yaml`, run codegen, validate the request with the generated Zod schema in a new Express handler, and call it from a frontend using the generated hook — all without hand-writing types.

---

## Module 17 — Usage Metering, Billing & Alerting
**Objective:** Turn raw call activity into accurate cost, credits, and alerts.

**Topics & code references:**
- Usage capture: real token/char totals accumulated in `pipeline.ts` (`getUsageTotals`) and written via `recordUsage` (`services/usage/record-usage.ts`); cost math in `computeCostMicros` (+ `invalidatePricingCache`).
- Storage: `usageEventsTable` (`schema/usage-events.ts`); wallet/credits via `walletTransactionsTable` + `walletBalanceCents` in `schema/users.ts`.
- Balance gating before a call: the wallet check in `handleWebCallWebSocket` (`webcall.ts`).
- Spend alerting: `evaluateAlertsAfterEvent`, `sweepAlerts`, `startAlertSweep` in `services/usage/alert-engine.ts`; notifications in `services/alert-notifications.ts`.
- Pricing seed/config: `scripts/src/seed-provider-pricing.ts`; provider pricing tables `schema/provider-pricing.ts` / `provider-minute-rates.ts`.

**Prerequisites:** Modules 5, 6, 9.

**Hands-on project:** Wire a fake call's `getUsageTotals` output through `recordUsage`, assert the `usage_events` row and `computeCostMicros` value, then trip a spend alert via `evaluateAlertsAfterEvent`.

---

## Module 18 — Testing & Debugging Voice AI Systems
**Objective:** Test deterministic units and debug a non-deterministic, real-time system.

**Topics & code references:**
- Existing unit tests as patterns: `services/rate-limit-cleanup.test.ts`, `services/alert-notifications.test.ts` (server); `components/create-agent-wizard.test.ts`, `pages/book/slotHelpers.test.ts`, `pages/book/bookingPayload.test.ts`, `pages/agents/edit.test.ts` (frontend).
- Pure functions that are ideal unit targets: `audio.ts` (`upsample8to16`, `estimatePitch`), `slot-engine.ts` (`getAvailableSlots`), `tool-executor.ts` (`parsePreferredDate`), `booking-tokens.ts` (`issueToken`/`verifyToken`).
- Manual tool testing surface: `routes/test-tool.ts`; in-browser web-call testing via `handleWebCallWebSocket`.
- Debugging real-time issues with structured logs: `req.log` in routes and the singleton `logger` (`lib/logger.ts`); fetch production logs for deployed issues.
- **Critical gotcha:** the api-server runs a prebuilt esbuild bundle — **restart the workflow after route/middleware edits** or new endpoints 404 (`.agents/memory/api-server-no-hot-reload.md`).

**Prerequisites:** Modules 2, 5, 10.

**Hands-on project:** Write a Vitest suite covering `parsePreferredDate` (relative + ISO inputs across timezones) and `getAvailableSlots` (override + buffer edge cases), then add a regression test for one barge-in threshold helper.

---

## Module 19 — Multi-Environment Deployment on Replit
**Objective:** Ship the platform across dev/staging/production with correct routing and config.

**Topics & code references:**
- Path-based artifact routing & the shared proxy: each artifact's `.replit-artifact/artifact.toml` (`paths = ["/api"]`); see the `pnpm-workspace` skill "Proxy & service routing".
- Binding to `PORT` and base paths per artifact; never hard-code ports (per `replit.md` run commands).
- Environment & secrets management: required env (`DATABASE_URL`, `APP_SECRET`/`SESSION_SECRET`, `GOOGLE_CLIENT_ID`/`SECRET`, `GROQ_API_KEY`, optional `GMAIL_USER`/`GMAIL_APP_PASSWORD`) — documented in `replit.md`; use the `environment-secrets` skill.
- Inter-service networking in prod: `localhost:PORT` works, `localhost:80` proxy does not inside the prod container (`.agents/memory/replit-production-networking.md`).
- Production gender-service startup quirk (lazy import) — `.agents/memory/gender-service-startup.md`.
- DB migration to prod & operational scripts: `pnpm --filter @workspace/db run push`; data hygiene via `scripts/src/wipe-beta-data.ts`; identity backfill `scripts/src/backfill-user-identity.ts` (commands in `replit.md`).

**Prerequisites:** Modules 1, 9, 14; the `deployment` and `database` skills.

**Hands-on project:** Configure and deploy the API server + dashboard as separate artifacts, verify path routing through the proxy (`/api/healthz` via `routes/health.ts`), promote a schema change to the production DB, and confirm with production logs.

---

## Capstone Project
**Build and deploy a vertical voice agent** (e.g., a dental-clinic receptionist) that demonstrates the full stack:
1. Define the agent + providers (Modules 4, 15) and a clinic system prompt with KB injection (Module 8).
2. Stand up the live pipeline over both phone and web call (Modules 3, 5, 6).
3. Give it scheduling tools so callers can book/reschedule/cancel by voice (Modules 7, 10, 11) with Google Calendar sync (Module 12).
4. Emit signed booking webhooks to a CRM (Module 13), meter usage and enforce wallet balance (Module 17).
5. Secure it with Google login + encrypted keys (Modules 14–15), expose it via the contract-first API (Module 16).
6. Test the deterministic pieces (Module 18) and deploy across environments on Replit (Module 19).

---

## Appendix: Reference Map (verified files)
- Audio/DTMF: `orchestration/audio.ts`, `orchestration/dtmf.ts`, `orchestration/audioPool.ts`, `orchestration/audioWorker.ts`, `orchestration/ambient.ts`, `orchestration/recorder.ts`
- Pipeline/session: `orchestration/pipeline.ts`, `orchestration/session.ts`, `orchestration/sessionStore.ts`, `orchestration/callerMemory.ts`, `orchestration/kb-retrieval.ts`, `orchestration/datetimeInject.ts`, `orchestration/types.ts`
- Telephony: `orchestration/telephony/{twilio,plivo,vobiz,webcall,dial,transfer}.ts`
- Adapters: `orchestration/adapters/{stt,llm,tts}/index.ts` (+ provider files)
- Tools/scheduling: `services/tool-executor.ts`, `services/scheduling/{slot-engine,lock,notifications,google-calendar,booking-tokens}.ts`
- Routes: `routes/index.ts`, `routes/auth.ts`, `routes/providers.ts`, `routes/webhooks.ts`, `routes/webhook-endpoints.ts`, `routes/campaign-webhook.ts`, `routes/health.ts`, `routes/test-tool.ts`, `routes/scheduling/{calendars,availability,event-types,public,bookings,slots,webhooks,google-oauth,index}.ts`
- Auth/crypto: `lib/{session,auth-compat,crypto,logger,redis}.ts`, `middlewares/{session,requireAuth,requireAdmin,userProvisioning}.ts`, `services/auth/google-login.ts`
- Usage: `services/usage/{record-usage,alert-engine}.ts`, `services/alert-notifications.ts`
- DB: `lib/db/src/schema/*.ts` (`agents`, `calls`, `providers`, `users`, `scheduling`, `knowledge`, `usage-events`, `platform-settings`, `webhook-endpoints`, `callerProfiles`, …)
- Contract/codegen: `lib/api-spec/openapi.yaml`, `lib/api-spec/orval.config.ts`, `lib/api-client-react/src/generated/api.ts`, `lib/api-zod/src/generated/api.ts`
- Scripts: `scripts/src/{seed-provider-pricing,wipe-beta-data,backfill-user-identity}.ts`
- Project docs: `replit.md`
