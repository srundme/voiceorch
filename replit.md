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
- **Settings** — placeholder for future platform-level config

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
- Provider `apiKey` is stored in plaintext in DB — production should encrypt at rest
- `pnpm run typecheck:libs` must run after adding new schema files to `lib/db/src/schema/` for the api-server to pick up the new types

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
