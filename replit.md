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
- `DATABASE_URL=<url> pnpm --filter @workspace/scripts run merge-user-identities` — consolidate duplicate `users` rows left by the Clerk→Google migration: relinks every legacy `user_…` row's data + wallet onto the user's canonical bare-numeric Google sub (matched by verified email), then deletes the empty legacy rows. **Dry-run by default** (prints the plan, read-only); add `-- --apply` to perform the merge (one tx per email group). Idempotent — safe to re-run. **Apply requires a confirmed production DB backup first.** Shares all merge logic with the Google login callback (`linkLegacyIdentitiesAtLogin` in `lib/db/src/identity-merge.ts`), which auto-links any remaining orphans on each sign-in so this never recurs.
- Required env: `DATABASE_URL` — Postgres connection string; `GROQ_API_KEY` — Seeds `managed_qwen_key` in `platform_settings` at startup if the row is absent; the Admin panel's Managed Keys page can override it at any time. Also used as a runtime fallback if the DB row is missing.
- Turn safety-net env (optional, sensible defaults in `orchestration/endpointing.ts`): `FORCE_FINALIZE_MS` (default 1800) — if STT streams partials but never a final, force-finalize the turn from the best partial after this many ms; `STALL_BACKSTOP_MS` (default 15000) — if no usable transcript arrives at all, speak a recovery reprompt after this many ms; `STALL_MAX_REPROMPTS` (default 2) — after this many reprompts with continued silence, end the call. Guards the Tamil/Hinglish "Listening…" hang on both telephony (`pipeline.ts`) and webcall (`telephony/webcall.ts`) paths.
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
- **LLM:** OpenAI, DeepSeek, Anthropic, Mistral, Cohere
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
- **Admin impersonation requires migration 0012:** `POST /api/admin/impersonate/:clerkId` writes `exchange_code` and `exchange_code_expires_at` in the initial INSERT. If migration `0012_impersonation_exchange_code` has not been applied to the production database, the INSERT will fail with an unknown column error. Run `pnpm --filter @workspace/db run push` (dev) or apply the migration SQL manually on prod before using "Login As User" in the admin panel.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
