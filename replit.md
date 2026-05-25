# VoiceOrch

AI voice agent orchestration SaaS platform — users bring their own provider API keys (ASR, LLM, TTS, telephony) and the platform handles the orchestration layer.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, served at `/api`)
- `pnpm --filter @workspace/dashboard run dev` — run the frontend (port 23183, served at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

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

## Gotchas

- After any OpenAPI spec change, always run `pnpm --filter @workspace/api-spec run codegen` then `pnpm run typecheck:libs` before touching backend routes
- Provider `apiKey` is encrypted at rest (AES-256-GCM, key derived from `SESSION_SECRET`)
- **Migration:** existing provider keys added before this change are still plaintext in the DB (decryptKey passes them through transparently). Re-save each provider in the Providers page to encrypt them.
- `pnpm run typecheck:libs` must run after adding new schema files to `lib/db/src/schema/` for the api-server to pick up the new types

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
