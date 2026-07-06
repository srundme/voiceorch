# VoiceOrch

AI voice agent orchestration SaaS platform — users bring their own provider API keys (ASR, LLM, TTS, telephony) and the platform handles the orchestration layer.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, served at `/api`)
- `pnpm --filter @workspace/dashboard run dev` — run the frontend (port 23183, served at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run backfill-user-identity` — backfill `email`/`name` from Clerk for users with NULL identity (requires `CLERK_SECRET_KEY`)
- `DATABASE_URL=<url> pnpm --filter @workspace/scripts run wipe-beta-data` — delete all agents, calls, campaigns, scheduling data from a database while keeping users, providers, wallets, and platform config (use prod URL for production wipe)
- `DATABASE_URL=<url> pnpm --filter @workspace/scripts run backfill-caller-identity` — rewrite `phone_number` to its canonical form across the three phone-keyed caller-memory tables (`caller_profiles`, `caller_facts`, `caller_call_archive`) so memory captured under non-canonical keys (e.g. `+919876543210` vs `919876543210` vs `09876543210`) is found on repeat calls. Merges rows that collapse to the same `(agent_id, canonical)` key (keeps newest profile + summed call_count, supersedes duplicate current facts, keeps all archive episodes). **Dry-run by default** (prints the plan, read-only); add `-- --apply` to perform the rewrite. Idempotent. Uses the same `canonicalizeCallerKey` (`@workspace/db`) the runtime read/write paths use. **Apply requires a confirmed DB backup first.**
- `DATABASE_URL=<url> pnpm --filter @workspace/scripts run merge-user-identities` — consolidate duplicate `users` rows left by the Clerk→Google migration: relinks every legacy `user_…` row's data + wallet onto the user's canonical bare-numeric Google sub (matched by verified email), then deletes the empty legacy rows. **Dry-run by default** (prints the plan, read-only); add `-- --apply` to perform the merge (one tx per email group). Idempotent — safe to re-run. **Apply requires a confirmed production DB backup first.** Shares all merge logic with the Google login callback (`linkLegacyIdentitiesAtLogin` in `lib/db/src/identity-merge.ts`), which auto-links any remaining orphans on each sign-in so this never recurs.
- Required env: `DATABASE_URL` — Postgres connection string; `GROQ_API_KEY` — Seeds `managed_qwen_key` in `platform_settings` at startup if the row is absent; the Admin panel's Managed Keys page can override it at any time. Also used as a runtime fallback if the DB row is missing.
- Turn safety-net env (optional, sensible defaults in `orchestration/endpointing.ts`): `FORCE_FINALIZE_MS` (default 1800) — if STT streams partials but never a final, force-finalize the turn from the best partial after this many ms; `STALL_BACKSTOP_MS` (default 15000) — if no usable transcript arrives at all, speak a recovery reprompt after this many ms; `STALL_MAX_REPROMPTS` (default 2) — after this many reprompts with continued silence, end the call. Guards the Tamil/Hinglish "Listening…" hang on both telephony (`pipeline.ts`) and webcall (`telephony/webcall.ts`) paths.
- Caller gender-detection env (optional, defaults in `orchestration/genderDetectorChained.ts`): `GENDER_CONFIDENCE_THRESHOLD` (default 0.60) — minimum model confidence (0–1) to lock the caller's gender; lower = the Sir/Ma'am salutation resolves sooner with fewer fall-throughs/retries; `GENDER_MIN_AUDIO_MS` (default 500) — minimum accumulated caller audio (ms) before a detection attempt fires; lower = a salutation can resolve within the caller's first, shorter response. Both telephony (`pipeline.ts`) and browser web calls (`telephony/webcall.ts`) feed the SAME shared `GenderDetectorChained` instance, so these two knobs cover both paths at once. Detection is still armed only AFTER the greeting completes; the rolling 10s max buffer, per-model 1.5s timeouts, fallback chain (wav2vec2 → autocorrelation → pitch), and lock-once behavior are unchanged.
- VoBiz acoustic AMD-confirmation env (optional, defaults in `orchestration/pipeline.ts` / `telephony/dial.ts`): per VoBiz docs, `machine_detection=true` does NOT deliver a verdict to the answer webhook — it arrives ONLY via the asynchronous `machine_detection_url` callback. So for every AMD-enabled VoBiz outbound call: (1) the dial sets `machine_detection_url` = `/api/webhooks/vobiz/amd` + `machine_detection_time` (`AMD_VOBIZ_DETECTION_TIME_MS`, default 3000, clamped 2000–10000); (2) the answer webhook arms acoustic confirmation UNCONDITIONALLY (`?amdArm=1` on the WS URL → `createSession({ amdArmed })`) — the media stream is always opened (never harms a human) and `confirmAmdMachineThenBranch()` holds the greeting while classifying the inbound speech-energy pattern; (3) the `/webhooks/vobiz/amd` callback resolves the LIVE session (CallUUID → `getSessionByExternalCallId`, fallback via call-record metadata) and feeds its verdict into the window via `pipeline.onExternalAmdSignal()` — "human" resolves human immediately; "machine" is a corroborating input only: it lowers the continuous-speech bar to `AMD_EXTERNAL_MACHINE_CONTINUOUS_MS` (default 2000) and extends the window once by `AMD_EXTERNAL_MACHINE_EXTEND_MS` (default 2000), but acoustic evidence still decides. Single-resolution: once the window resolves, late/duplicate callbacks are logged + ignored; with no live session the callback falls back to raw-flag persistence. Only a confirmed machine enacts `voicemailAction` (leave_message / hangup / continue); the confirmed verdict (not the raw flag) is persisted to `calls.amdResult`. Twilio/Plivo keep their trusted synchronous AMD (static XML) unchanged. Acoustic knobs: `AMD_CONFIRM_WINDOW_MS` (default 4000) — hard cap on the confirmation hold; on elapse the verdict is HUMAN (bias toward not harming a live caller); `AMD_CONTINUOUS_GREETING_MS` (default 3000) — a single continuous speech run reaching this = MACHINE (a voicemail greeting is a long monologue); lower = quicker machine lock but more risk of clipping a talkative human; `AMD_SPEECH_GAP_MS` (default 400) — silence gap that ends the current continuous run; `AMD_HUMAN_PAUSE_MS` (default 700) — a short utterance then a pause this long = HUMAN (suspended while an external "machine" verdict awaits corroboration); `AMD_NO_SPEECH_HUMAN_MS` (default 1500) — no speech heard this soon after answer = HUMAN (also suspended under a pending external "machine"); `AMD_CONFIRM_ENERGY_THRESHOLD` (default 300) — PCM energy floor counted as speech during confirmation. A synchronous machine flag, if VoBiz ever sends one, is still honored as an extra hint (`amdHint=machine` threaded answer-webhook → `getVobizAnswerXML` → WS URL → `index.ts` → `handleVobizWebSocket` → `createSession`). The legacy `vm=1` voicemail-delivery WS route still exists but the VoBiz answer webhook no longer uses it.
- Sarvam raw-SSE diagnostic env (optional, OFF by default; `orchestration/adapters/llm/sarvam.ts`): `SARVAM_RAW_SSE_DEBUG` — set to `1`/`true` to log a single structured record (`evt: "sarvam_raw_sse_json_in_content"`) each time the Sarvam LLM adapter's buffer-and-sniff path resolves a tool call that Sarvam streamed as JSON text in `delta.content` instead of structured `delta.tool_calls`. The record carries `callId`, `model`, `sawToolDelta`, `parseSucceeded`, `resolvedToolName`, `fellBackToText`, and a length-capped (2000-char) `jsonBuffer` for proof. With the flag off, behavior and log output are unchanged; nothing is logged on the structured tool-call path or ordinary plain-text replies. Never logs the API key or full PII beyond the truncated buffer.
- Gemini explicit context-caching env (optional, defaults in `orchestration/adapters/llm/google.ts`): cuts Gemini (`google` provider, `gemini-2.5-flash`) TTFT by registering the large static system-prompt prefix as a `CachedContent` once per call so it is not reprocessed every turn (`usage.cachedTokens>0` from turn 2). `GEMINI_CACHE_ENABLED` (default on; set `false`/`0` to disable); `GEMINI_CACHE_MIN_CHARS` (default 4096) — minimum base length before a cache is even attempted; `GEMINI_CACHE_TTL_SECONDS` (default 900); `GEMINI_CACHE_MAX_WARMS` (default 3) — cap on cache-create attempts per call before caching latches OFF. **Design:** the cached prefix is exactly `langGuard + agent.systemPrompt + langGuard` (captured in `pipeline.ts` as `cacheBaseForTurn` BEFORE any per-turn volatile append), so Tamil/language rules, staged prompts, gender salutation, KB slice, tool guides, `[TOOL CALLING]`, and the per-turn `[CURRENT DATE & TIME]` all stay in the volatile tail (prepended to the current user message on the cached path) and are never frozen into the cache. `pipeline.greet()` fire-and-forgets a `warmContextCache(buildCacheBase(), toolDefs)` during the greeting so turn 1 can already reuse it (skipped for staged-prompt agents — their prompt is replaced, so the base would never match). `buildLangGuard()`/`buildCacheBase()` in `pipeline.ts` are the single source of truth shared by the warm and the per-turn assembly — they MUST stay byte-identical or the cache silently never reuses. **Fallback is total and safe:** any cache error (see below), a tool-result turn, a staged-prompt turn (prompt no longer starts with the base), or a too-short base all fall through to the unchanged uncached path (`cacheEligible()` guard). Tamil quality, tool calls, salutation, language injection, and preamble stripping are unaffected on both paths.
- **Gemini free-tier keys cannot create caches (gotcha):** `cachedContent.create` returns HTTP 429 (`limit=0`) on a free-tier `GEMINI_API_KEY` — this is expected and logged once as `evt: "gemini_context_cache_disabled"` ("…expected on free-tier keys"), after which caching latches off for the rest of that call. A paid key logs `evt: "gemini_context_cache_created"` and per-turn `cachedTokens>0` (visible in the existing "LLM prompt cache" turn log). Do NOT treat the free-tier 429 as a bug. **As of 2026-07-06, `GEMINI_API_KEY` is a paid-tier key from a billed GCP project** — verified directly against `cachedContents.create`; caching is expected to be live in production.
- `GEMINI_API_KEY` is auto-seeded into `platform_settings.managed_gemini_key` at server startup (`seedManagedKeyFromEnv`, same pattern as Groq/Sarvam/Cartesia) — no manual Admin panel step needed to update the managed Gemini key; just update the secret and restart.
- Gemini adapter latency/reliability env (optional, `orchestration/adapters/llm/google.ts`): `GEMINI_REQUEST_TIMEOUT_MS` (default 20000) — hard per-request timeout passed to the SDK so a stalled Gemini connection fails fast and the pipeline's existing same-provider retry / fallback-LLM logic can take over, instead of hanging the turn (the legacy SDK has no timeout of its own). The adapter also now honors the agent's `maxTokens` generation param as Gemini's `maxOutputTokens` (same rationale as the Groq/Qwen adapters — bounds worst-case output length, and therefore total per-turn latency); unset by default, so behavior is unchanged unless an agent has `llmMaxTokens`/`maxTokens` configured.
- **Gemini API surface decision (2026-07-06):** Google's docs now recommend a new "Interactions API" (`@google/genai` SDK, `interactions.create()`, stateful history, step-based SSE with explicit `thought`/`model_output`/`function_call` steps) for new projects. We deliberately did NOT migrate to it: the classic `generateContent`/chat API our adapter uses (via the legacy `@google/generative-ai` SDK) remains fully documented and supported (Google's own docs page has a toggle between the two), the Interactions API's step/event model adds real integration risk (different tool-calling flow, different caching API) with no demonstrated latency benefit for a plain conversational turn, and the legacy SDK has zero runtime HTTP dependencies (uses native `fetch`), so it already benefits from the shared undici keep-alive pool. Revisit only if Google actually sunsets `generateContent`/the legacy SDK.
- **Gemini model lineup (2026-07-06):** dashboard/admin `LLM_MODELS.google` now also offers `gemini-3.1-flash-lite` and `gemini-3.5-flash` alongside the existing 2.5/1.5 models — live-tested against the API with Tamil colloquial prompts, both return natural spoken-register Tamil text (language quality comes from the shared `buildLangGuard()` prompt rules, not the model choice). **Gemini 2.5 Flash-Lite remains the only Gemini model that can FULLY disable thinking** (`thinkingBudget:0`); the entire Gemini 3.x family (Flash and Flash-Lite included) can only go as low as `thinkingLevel:"minimal"` — sending both knobs together is an API error. `google.ts`'s `isGemini3` getter (`/^gemini-3(\.|-)/`) branches `generationConfig.thinkingConfig` between the two shapes automatically; no per-agent config needed. For the strictest zero-thinking-overhead voice latency, 2.5 Flash-Lite is still the safest default — the 3.x models trade a small, currently-unmeasured amount of TTFT for materially better reasoning/instruction-following quality.
- KB size cap env: `KB_INJECT_MAX_CHARS` (`session.ts`) — caps the baked knowledge-base block prepended to the static system prompt (truncated on a newline boundary), shrinking the cached prefix and per-turn input tokens. **Default is Gemini-scoped and conservative:** for `google` agents the baked block is capped at 8000 chars (`KB_INJECT_DEFAULT_GEMINI_CHARS`) so only very large KBs are trimmed; every other provider keeps full injection unchanged. Setting `KB_INJECT_MAX_CHARS` (any value, including `0` to disable) overrides the default for ALL providers. Safe because live per-turn KB retrieval (`retrieveKbContextMulti`) still injects the relevant slice every turn regardless of this cap — the baked full document is largely redundant with it.
- HTTP keep-alive pool env (optional, defaults in `orchestration/http/pool.ts`): `HTTP_POOL_KEEPALIVE_TIMEOUT_MS` (default 30000) — how long an idle pooled socket stays warm; must comfortably exceed real between-turn gaps (caller pauses, reading digits) or the next provider call re-pays the TCP+TLS handshake — tune up from the `http_pool_connect` reconnect logs; `HTTP_POOL_KEEPALIVE_MAX_TIMEOUT_MS` (default 600000); `HTTP_POOL_CONNECTIONS` (default 128, max per origin); `HTTP_POOL_PIPELINING` (default 1, keep at 1 for h1). Installed at startup via `setGlobalDispatcher` — **process-wide**: covers every outbound HTTP call (LLM/TTS/STT REST, telephony provider REST, self-webhooks, memory proxy, Google Calendar, object storage), not just the provider adapters. WebSocket streaming STT/TTS do NOT use this dispatcher and are unaffected. HTTP/1.1 keep-alive reuse only — h2 is deliberately NOT forced (these REST endpoints don't reliably negotiate it over undici). Graceful shutdown uses `Agent.close()` (not `destroy()`) so in-flight provider calls on a live call survive a Railway SIGTERM redeploy.

## Business model — two plans

- **Managed plan** (default for all sign-ups): User creates agents; SnapServe supplies all provider keys (LLM/ASR/TTS). Billed at **$0.05/min**. This is the experience for users who have NOT added any provider keys in the Providers page.
- **BYOP (Bring Your Own Providers)**: User adds their own provider API keys in the Providers page. Billed at **$0.035/min** orchestration fee only (user pays providers directly). Activated automatically whenever a user has configured keys for any of the agent's providers.

Billing mode is resolved **dynamically** at call-end time in `minute-rates.ts → resolveAgentBillingMode()`:
- Check `providers` table for user's keys matching the agent's ASR/LLM/TTS providers.
- Any match → BYOP rate. No match → managed rate.

**Admin panel** (`/admin`) = SnapServe's internal ops dashboard (not visible to end-users). Manages platform keys, user accounts, platform config.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Wouter routing, TanStack Query, shadcn/ui, Recharts
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (agents, calls, providers)
- `artifacts/api-server/src/routes/` — Express route handlers (agents, calls, providers, analytics)
- `artifacts/dashboard/src/pages/` — React page components
- `lib/api-client-react/src/generated/` — auto-generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — auto-generated Zod schemas for server validation (do not edit)

## Architecture decisions

- Contract-first: OpenAPI spec → Orval codegen → typed hooks (frontend) + Zod schemas (server)
- Provider API keys stored server-side; only last-4-char hint shown in UI
- Agent toggle updates status between "active"/"inactive" via PATCH `/agents/:id/toggle`
- Call end flow (`PATCH /calls/:id/end`) auto-computes duration and updates agent success metrics
- Analytics endpoints are read-only aggregations — no client-side computation needed

## Auth (end-user)

- **Standalone Google OAuth** — no Clerk. The platform owns the Google OAuth app (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, shared with calendar) and issues its own session token.
- Session token: HS256 JWT signed with `SESSION_SECRET` (`lib/session.ts`), 30-day TTL, carries Google `sub` + email + name. Delivered to the SPA via the callback URL fragment (`#session=<jwt>`); the frontend (`dashboard/src/lib/auth.tsx`) stores it in `localStorage["voiceorch:session"]`.
- Client→server: `Authorization: Bearer <jwt>` (via `setAuthTokenGetter`/`getToken`), plus `?token=` query for SSE. `attachSession` middleware validates and sets `req.clerkUserId` (= Google sub) + `req.sessionPayload`.
- `users.clerk_id` column is **repurposed** to store the Google `sub` (not renamed). First-time users provisioned with email/name/API keys + $5 welcome credit (`userProvisioning.ts`).
- Login routes: `GET /api/auth/google/connect` (redirect), `GET /api/auth/google/callback` (issues token). `getAuth(req)` is a local shim (`lib/auth-compat.ts`) reading `req.clerkUserId` — kept so ~20 route files compile unchanged.
- Admin auth is separate (`x-admin-token`) and untouched.

## Product

- **Dashboard** — overview stats (agents, calls today, success rate, avg duration), call volume chart, status breakdown pie chart
- **Agents** — create/manage voice agents with ASR + LLM + TTS + telephony pipeline config
- **Calls Log** — filterable call history with transcripts and status tracking
- **Providers** — manage user-supplied API keys (masked), grouped by type: ASR / LLM / TTS / Telephony
- **Scheduling** — multi-tenant booking engine: calendars, event types, availability windows, date overrides, advisory-locked slot booking, email notifications, webhook dispatch
- **Public Booking Page** — unauthenticated `/book/:slug` page for attendees to pick a slot and book
- **Settings** — placeholder for future platform-level config

## Scheduling Architecture

- 6 DB tables: `scheduling_calendars`, `event_types`, `availability_schedules`, `availability_overrides`, `bookings`, `google_calendar_connections`
- Slot engine (`services/scheduling/slot-engine.ts`): date-fns-tz aware, respects weekly schedules + overrides + existing bookings
- Advisory lock (`services/scheduling/lock.ts`): `pg_try_advisory_xact_lock` prevents double-booking
- Email (`services/scheduling/notifications.ts`): nodemailer/Gmail, gracefully skipped if env vars absent
- Webhooks: `dispatchSchedulingWebhooks` in `routes/scheduling/webhooks.ts`
- Public routes (no auth): `GET /api/scheduling/public/event-types/:slug`, `GET /api/scheduling/public/slots`, `POST /api/scheduling/public/bookings`
- Env: `GMAIL_USER` + `GMAIL_APP_PASSWORD` (optional) for email notifications
- **Google OAuth (SaaS-style):** Platform owns ONE Google OAuth app (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` env vars). Users click "Connect with Google" — no developer setup. Multiple Google accounts per user supported. Each calendar can be mapped to a specific Google account via `google_calendar_connection_id`.
- Google routes: `GET /api/scheduling/google/connect` (redirect), `GET /api/scheduling/google/callback` (no auth — uses `state` param), `GET/DELETE /api/scheduling/google/connections`, `GET /api/scheduling/google/calendar-links`, `PATCH /api/scheduling/calendars/:id/google-connection`
- Tokens encrypted at rest via `encryptKey`/`decryptKey`; auto-refresh on expiry

## Supported providers

- **ASR:** Deepgram, Azure, Whisper
- **LLM:** OpenAI, DeepSeek, Anthropic, Mistral, Cohere, Groq, Qwen (via Groq), Sarvam, OpenRouter (Qwen3.5/Qwen3.6 — BYOP only, no managed key)
- **TTS:** ElevenLabs, OpenAI, AWS Polly, Azure, Cartesia, Deepgram
- **Telephony:** Twilio, Plivo, Vonage

## User preferences

- Platform charges orchestration fee only; users bring their own provider keys
- Inspired by Bolna open-source framework architecture
- **GitHub push:** Railway deploys from `srundme/voiceorch` main. Push every code edit there via the REST contents API using the `GITHUB_PERSONAL_ACCESS_TOKEN` secret (NOT `GITHUB_PAT`, which is stale/invalid). Auth header `Authorization: token $GITHUB_PERSONAL_ACCESS_TOKEN`. Do this automatically — don't ask each time.

## Gotchas

- After any OpenAPI spec change, always run `pnpm --filter @workspace/api-spec run codegen` then `pnpm run typecheck:libs` before touching backend routes
- Provider `apiKey` is encrypted at rest (AES-256-GCM, key derived from `SESSION_SECRET`)
- **Migration:** existing provider keys added before this change are still plaintext in the DB (decryptKey passes them through transparently). Re-save each provider in the Providers page to encrypt them.
- `pnpm run typecheck:libs` must run after adding new schema files to `lib/db/src/schema/` for the api-server to pick up the new types
- **Short-lived `platform_settings` keys:** Any code that writes transient/rate-limit rows to `platform_settings` must call `registerTransientKey({ prefix, windowMs })` from `services/rate-limit-cleanup.ts` at startup so the hourly cleanup sweep deletes them automatically. Do NOT add a separate cleanup loop.
- **Caller memory is keyed on a canonical phone identity:** `caller_profiles` / `caller_facts` / `caller_call_archive` are keyed on `(agent_id, phone_number)`. The phone_number MUST be derived via `canonicalizeCallerKey` (`lib/db/src/caller-identity.ts`, exported from `@workspace/db`) on BOTH the read path (`loadCallerContext`) and the write path (`updateCallerProfile`/`archiveCall`/`supersedeFact`/`latch*`) — otherwise format drift between calls (`+` prefix, trunk `0`, inbound `fromNumber` vs outbound `toNumber`) silently misses stored memory and the agent greets a returning caller as a stranger. `humanPhone` already returns canonical; web calls use the synthetic `webcall:user_<id>` key (passed through unchanged). India defaults (CC `91`, national length `10`) are tunable via `CALLER_ID_DEFAULT_CC` / `CALLER_ID_NATIONAL_LEN`. Run `backfill-caller-identity` once after deploy to canonicalize historical rows. `loadCallerContext` logs a "Caller memory retrieval" hit/miss line for diagnosis.
- **Admin impersonation requires migration 0012:** `POST /api/admin/impersonate/:clerkId` writes `exchange_code` and `exchange_code_expires_at` in the initial INSERT. If migration `0012_impersonation_exchange_code` has not been applied to the production database, the INSERT will fail with an unknown column error. Run `pnpm --filter @workspace/db run push` (dev) or apply the migration SQL manually on prod before using "Login As User" in the admin panel.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
