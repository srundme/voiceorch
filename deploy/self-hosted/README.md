# VoiceOrch — Self-Hosted Orchestration Layer

This packages just the orchestration engine (API server + dashboard) so you can
run VoiceOrch on your own infrastructure. It does **not** include SnapServe's
internal admin panel, and it ships with **no managed provider keys** — you
bring your own database, your own Google OAuth app, and your own ASR/LLM/TTS/
telephony provider keys.

## What you bring

| Thing | Where it's configured |
|---|---|
| PostgreSQL database | `docker-compose.yml` bundles one for you, or point `DATABASE_URL` at your own |
| Provider keys (ASR/LLM/TTS/telephony) | Inside the app's **Providers** page after first login — per-agent, BYOP only |
| Google OAuth app (for login + calendar sync) | Your own Google Cloud Console project — optional |
| Outbound email for booking confirmations | Your own Gmail app password — optional |
| Redis (optional caching) | Your own instance, or leave unset — app degrades gracefully |

Nothing here talks to SnapServe's servers, and there is no phone-home or
per-minute billing — this deployment cannot be metered by us, so it only makes
sense with your own provider accounts.

## Quick start

```bash
cd deploy/self-hosted
cp .env.example .env
# edit .env: SESSION_SECRET, POSTGRES_PASSWORD, APP_DOMAIN at minimum
docker compose up -d --build
```

The app will be reachable on `http://localhost:8080` (or whatever `PORT` you
set). On first boot it needs its database schema created — see below.

## Database schema

The image ships with the Drizzle migration files but does not auto-apply them
on boot (so an upgrade never runs a destructive migration unattended). Apply
them once after first startup, and again after every version upgrade, from a
machine that has this source checked out and `pnpm` installed, pointed at the
compose Postgres (published on `localhost:5432` by default):

```bash
DATABASE_URL=postgres://voiceorch:<POSTGRES_PASSWORD>@localhost:5432/voiceorch \
  pnpm --filter @workspace/db run push
```

If you'd rather not expose the DB port, add `ports: ["5432:5432"]` to the `db`
service temporarily, run the push, then remove it again.

## Google login / calendar

If you leave `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` blank, Google login and
Google Calendar scheduling sync are simply unavailable — the rest of the app
(agents, calls, BYOP providers) works fine without them. To enable them:

1. Create an OAuth 2.0 Client ID in Google Cloud Console.
2. Add an authorized redirect URI: `https://<APP_DOMAIN>/api/auth/google/callback`
3. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env` and restart.

## Upgrading

1. Pull the latest source / image tag.
2. `docker compose up -d --build`
3. Re-run the schema push command above — Drizzle migrations are additive and
   safe to re-run.

## What's intentionally excluded

- **Admin panel** — SnapServe's internal ops dashboard for managing platform
  keys and customer accounts across all tenants. Not applicable to a
  single-tenant self-hosted install.
- **Managed AI provider keys** — no `GEMINI_API_KEY`/`GROQ_API_KEY` etc. are
  seeded. Every agent must use a provider key you've added yourself in the
  Providers page.
- **Object storage** — not needed. Call recordings are stored directly in
  Postgres.
