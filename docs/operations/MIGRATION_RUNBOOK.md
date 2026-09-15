# VoiceOrch — Replit → Cursor / Railway Migration Runbook

This document is a self-contained reference for reproducing the full VoiceOrch production environment outside of Replit. Follow the sections top-to-bottom if you are starting from scratch; jump to a specific section if you are patching an existing Railway deployment.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone & local dev setup (Cursor)](#2-clone--local-dev-setup-cursor)
3. [Environment variables reference](#3-environment-variables-reference)
4. [Railway service topology](#4-railway-service-topology)
5. [Postgres / Drizzle setup](#5-postgres--drizzle-setup)
6. [GitHub → Railway deploy](#6-github--railway-deploy)
7. [Google OAuth reconfiguration](#7-google-oauth-reconfiguration)
8. [Post-migration smoke-test checklist](#8-post-migration-smoke-test-checklist)

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 24 LTS | Install via [nvm](https://github.com/nvm-sh/nvm): `nvm install 24` |
| pnpm | 10.x | `npm install -g pnpm@10` |
| Git | any recent | needed to push to `srundme/voiceorch` |
| Railway CLI | latest | `npm install -g @railway/cli` (optional; UI is fine for setup) |

---

## 2. Clone & local dev setup (Cursor)

```bash
git clone https://github.com/srundme/voiceorch.git
cd voiceorch

# Install all workspace dependencies
pnpm install

# Copy the example env file and fill in real values (see Section 3)
cp .env.example .env
```

### Per-service dev commands

Run each in a separate terminal:

```bash
# API server — port 8080, served at /api
pnpm --filter @workspace/api-server run dev

# Dashboard (React + Vite) — port 23183, served at /
pnpm --filter @workspace/dashboard run dev

# Gender analysis service (Python / FastAPI) — port 5000
# See artifacts/gender-service/ for its own README / startup
```

### Other useful commands

```bash
# Full typecheck across all packages
pnpm run typecheck

# Regenerate API hooks + Zod schemas from the OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Push DB schema changes to the dev database
pnpm --filter @workspace/db run push

# Wipe beta data from any database (keeps users, providers, wallets, platform config)
DATABASE_URL=<url> pnpm --filter @workspace/scripts run wipe-beta-data
```

---

## 3. Environment variables reference

Set these as Railway Variables in the Railway dashboard (or in `.env` for local dev). Railway injects `PORT` automatically — do **not** hardcode it.

### 3.1 Required — server will not start without these

| Variable | Purpose | How to obtain |
|----------|---------|---------------|
| `DATABASE_URL` | PostgreSQL connection string | Railway Postgres service → "Connect" tab → copy the private URL |
| `SESSION_SECRET` | Signs HS256 session JWTs and derives the AES-256 key used to encrypt provider API keys at rest. Minimum 32 bytes. | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NODE_ENV` | Set to `production` on Railway | Literal string `production` |

> **Important:** `SESSION_SECRET` must never change after launch. Changing it invalidates all active user sessions and renders all encrypted provider keys unreadable.

### 3.2 AI / voice providers (managed platform keys)

| Variable | Purpose | How to obtain |
|----------|---------|---------------|
| `GROQ_API_KEY` | Managed LLM key — seeded into `platform_settings.managed_qwen_key` at startup. Also used as a runtime fallback if the DB row is missing. Admin panel → Managed Keys can override it at any time. | [console.groq.com](https://console.groq.com) |
| `SARVAM_API_KEY` | Sarvam ASR / STT (managed plan) | [sarvam.ai](https://sarvam.ai) |
| `CARTESIA_API_KEY` | Cartesia TTS (managed plan) | [cartesia.ai](https://cartesia.ai) |

### 3.3 Google OAuth (login + Google Calendar)

One OAuth app covers both end-user login and Google Calendar sync.

| Variable | Purpose | How to obtain |
|----------|---------|---------------|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret | same credential |
| `GOOGLE_LOGIN_REDIRECT_URI` | Redirect URI for the **login** flow. Must match an Authorized Redirect URI in Google Cloud Console. | Set to `https://<your-railway-domain>/api/auth/google/callback` |
| `GOOGLE_REDIRECT_URI` | Redirect URI for the **Google Calendar** OAuth flow. | Set to `https://<your-railway-domain>/api/scheduling/google/callback` |
| `APP_BASE_URL` | Canonical base URL of the deployment. Used by `oauth-redirect.ts` when `REPLIT_DOMAINS` is absent. Must not have a trailing slash. | e.g. `https://voiceorch.up.railway.app` |

> See [Section 7](#7-google-oauth-reconfiguration) for step-by-step Google Cloud Console instructions.

### 3.4 Payments (Razorpay)

| Variable | Purpose | How to obtain |
|----------|---------|---------------|
| `RAZORPAY_KEY_ID` | Razorpay public key ID | [dashboard.razorpay.com](https://dashboard.razorpay.com) → Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | Razorpay secret key | same page |

Wallet top-up and recurring auto-debit are fully disabled when these two vars are absent — the server returns `503` on wallet endpoints but remains otherwise functional.

### 3.5 Redis (optional — gracefully degrades)

| Variable | Purpose | How to obtain |
|----------|---------|---------------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint (must start with `https://`) | [upstash.com](https://upstash.com) → create a database → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash read-write token | same page |

When absent, the server logs a warning and Redis session backing is disabled. All other features continue to work.

### 3.6 Email (optional)

| Variable | Purpose | How to obtain |
|----------|---------|---------------|
| `BREVO_API_KEY` | Transactional email via Brevo (Sendinblue) — password reset OTPs | [app.brevo.com](https://app.brevo.com) → SMTP & API → API Keys |
| `GMAIL_USER` | Gmail address for scheduling notifications and spike alerts | Any Gmail account |
| `GMAIL_APP_PASSWORD` | App password for that Gmail account | Google Account → Security → 2FA → App passwords |

Scheduling email and spike alert emails are silently skipped when these are absent.

### 3.7 Telephony (optional)

| Variable | Purpose | How to obtain |
|----------|---------|---------------|
| `VOBIZ_AUTH_ID` | VoBiz telephony auth ID | VoBiz dashboard |
| `VOBIZ_AUTH_TOKEN` | VoBiz auth token | same |

User-supplied Twilio, Plivo, and Vonage keys are stored per-user in the `providers` table (encrypted at rest) and are never read from env.

### 3.8 Admin

| Variable | Purpose | How to obtain |
|----------|---------|---------------|
| `ADMIN_TOKEN` | Bearer token for the `/admin` ops panel. Passed as `x-admin-token` header. | Generate any strong random string: `openssl rand -hex 32` |

### 3.9 Internal services

| Variable | Purpose | Notes |
|----------|---------|-------|
| `GENDER_SERVICE_URL` | Base URL of the gender analysis microservice. **No trailing slash. No path suffix.** The API server appends `/voice-analysis/gender-ml` and `/voice-analysis/gender-ml-v2` automatically. | Railway internal: `http://gender-service.railway.internal:5000` |
| `WEBHOOK_BASE_URL` | Override for the base URL the server uses when constructing self-webhook URLs (campaign callbacks, scheduling webhooks). Falls back to `REPLIT_DOMAINS` then `localhost:PORT`. | Set to `https://<your-railway-domain>` in prod |
| `AGNOST_API_KEY` | Optional Agnost integration init key | Leave unset if not using Agnost |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Replit Object Storage bucket for ambient audio recordings. Only relevant in the Replit environment. | Leave unset on Railway (feature falls back gracefully) |

### 3.10 Tunables (optional, safe defaults built-in)

| Variable | Default | Purpose |
|----------|---------|---------|
| `FORCE_FINALIZE_MS` | `1800` | ms after which the turn is force-finalized from the best partial if STT never delivers a final transcript |
| `STALL_BACKSTOP_MS` | `15000` | ms of silence before speaking a recovery reprompt |
| `STALL_MAX_REPROMPTS` | `2` | number of reprompts before ending the call |
| `HTTP_POOL_KEEPALIVE_TIMEOUT_MS` | `30000` | idle keep-alive socket lifetime; tune up if `http_pool_connect` reconnect logs appear frequently |
| `HTTP_POOL_KEEPALIVE_MAX_TIMEOUT_MS` | `600000` | hard upper bound |
| `HTTP_POOL_CONNECTIONS` | `128` | max connections per origin |
| `HTTP_POOL_PIPELINING` | `1` | keep at 1 for HTTP/1.1 |
| `OTP_RATE_LIMIT_MAX` | `3` | max password-reset OTP requests per window |
| `OTP_RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | OTP rate-limit window |
| `DPDP_RETENTION_DAYS` | `90` | DPDP data-retention window in days |
| `DISPOSITION_LLM` | Groq Llama | LLM model name used for post-call disposition classification |

---

## 4. Railway service topology

Deploy four Railway services inside a single Railway project. They share a private network and communicate via Railway's internal DNS (`*.railway.internal`).

```
┌─────────────────────────────────────────────────────────────┐
│  Railway Project: voiceorch                                 │
│                                                             │
│  ┌──────────────────┐    DATABASE_URL (private)             │
│  │  api-server      │◄──────────────────────────┐           │
│  │  Node.js 24      │                           │           │
│  │  port 8080       │    GENDER_SERVICE_URL      │           │
│  │  /api, /ws       │──────────────────────┐    │           │
│  └──────────────────┘                      │    │           │
│                                            ▼    │           │
│  ┌──────────────────┐           ┌──────────────────┐        │
│  │  gender-service  │           │  PostgreSQL       │        │
│  │  Python/FastAPI  │           │  Railway managed  │        │
│  │  port 5000       │           │                  │        │
│  └──────────────────┘           └──────────────────┘        │
│                                                             │
│  ┌──────────────────┐                                       │
│  │  Upstash Redis   │  (external SaaS, free tier OK)        │
│  │  REST over HTTPS │                                       │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
```

### Service configuration summary

| Service | Source | Build command | Start command | Port | Health path |
|---------|--------|---------------|---------------|------|-------------|
| **api-server** | `srundme/voiceorch` main | `pnpm --filter @workspace/api-server run build` | `node --enable-source-maps artifacts/api-server/dist/index.mjs` | `$PORT` (Railway injects) | `/api/healthz` |
| **gender-service** | `srundme/voiceorch` main | Docker build from `artifacts/gender-service/` | uvicorn inside container | 5000 | `/voice-analysis/health` |
| **PostgreSQL** | Railway managed add-on | — | — | 5432 (private) | — |
| **Upstash Redis** | [upstash.com](https://upstash.com) (external) | — | — | REST HTTPS | — |

### Wiring env vars between services

After creating the Railway Postgres service, copy its **private** `DATABASE_URL` from the "Connect" tab and set it as a variable on the **api-server** service.

For the gender service:
```
GENDER_SERVICE_URL=http://gender-service.railway.internal:5000
```

Set this on the **api-server** service. The service name `gender-service` must match the Railway service name exactly (Railway uses it as the internal hostname).

> **Note:** Use the **private** Railway networking URL (`*.railway.internal`) for inter-service calls — never the public URL. The public URL is for external traffic only and adds unnecessary latency + egress cost.

---

## 5. Postgres / Drizzle setup

### 5.1 Provision a Railway Postgres service

1. In the Railway project, click **+ New** → **Database** → **Add PostgreSQL**.
2. Copy the **Private URL** from the "Connect" tab.
3. Set `DATABASE_URL=<private-url>` on the api-server service.

### 5.2 Run Drizzle migrations

```bash
# From the repo root — runs against whichever DATABASE_URL is in your environment
pnpm --filter @workspace/db run push
```

This command applies all pending migrations from `lib/db/drizzle/` and seeds the migration journal.

### 5.3 bootstrapMigrationJournal caveat

`pnpm --filter @workspace/db run push` calls `bootstrapMigrationJournal` internally, which seeds the Drizzle journal with existing migration records **without re-running their SQL**. This is safe for tables that already exist.

**However:** any brand-new table or column added to `lib/db/src/schema/` after this point **must** have a new Drizzle migration file with a fresh `when` timestamp. A journal-only seed will not create the new table — the api-server will crash with `relation does not exist` on first use. To generate a new migration file:

```bash
pnpm --filter @workspace/db run generate   # creates a new file in lib/db/drizzle/
pnpm --filter @workspace/db run push       # applies it
```

### 5.4 Admin impersonation migration

If you see `unknown column exchange_code` when using "Login As User" in the admin panel, migration `0012_impersonation_exchange_code` has not been applied. Run `push` again or apply the SQL manually on the production database.

### 5.5 Encrypted provider keys

Provider API keys are encrypted at rest using AES-256-GCM with a key derived from `SESSION_SECRET`. Any keys that were stored before encryption was introduced are stored as plaintext — `decryptKey` passes them through transparently. Ask users to re-save their keys from the Providers page to encrypt them.

---

## 6. GitHub → Railway deploy

Railway is configured to auto-deploy from the `main` branch of `srundme/voiceorch` on every push.

### 6.1 Railway service settings for api-server

| Setting | Value |
|---------|-------|
| **Source** | GitHub → `srundme/voiceorch`, branch `main` |
| **Root directory** | `/` (repo root) |
| **Build command** | `pnpm --filter @workspace/api-server run build` |
| **Start command** | `node --enable-source-maps artifacts/api-server/dist/index.mjs` |
| **Health check path** | `/api/healthz` |
| **Health check initial delay** | 90 seconds |

### 6.2 Generate SESSION_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and set it as `SESSION_SECRET` in Railway Variables before the first deploy.

### 6.3 Build notes

- The build requires `lib/db/drizzle/` to be copied into the production bundle. This is handled by the esbuild config; do not remove the `COPY lib/db/drizzle ./lib/db/drizzle` step if using a custom Dockerfile.
- `pnpm run typecheck:libs` must be run (or pass in CI) after adding new files to `lib/db/src/schema/` or the api-server will not pick up new types.
- After any OpenAPI spec change, run `pnpm --filter @workspace/api-spec run codegen` before building.

### 6.4 Graceful shutdown on Railway SIGTERM

The HTTP keep-alive pool uses `Agent.close()` (not `destroy()`) on SIGTERM so in-flight provider calls survive Railway's rolling redeploy. No changes needed — this is already wired in `orchestration/http/pool.ts`.

### 6.5 Dashboard / Admin / Family App static artifacts

The dashboard, admin panel, and any other Vite-built SPAs can be:
- **Option A (recommended):** Deploy as a separate Railway static service or any CDN (Vercel, Cloudflare Pages). Point `APP_BASE_URL` on the api-server to the same root domain.
- **Option B:** Serve from the api-server itself by setting `FRONTEND_DIST_PATH` and `ADMIN_DIST_PATH` env vars to the built `dist/` directories on the container filesystem.

---

## 7. Google OAuth reconfiguration

The platform owns **one** Google OAuth app that covers both end-user login and Google Calendar sync. When the domain changes from Replit to Railway, you must update the Authorized Redirect URIs in Google Cloud Console.

### 7.1 Update redirect URIs

1. Open [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services** → **Credentials**.
2. Click the OAuth 2.0 Client ID used for VoiceOrch.
3. Under **Authorized redirect URIs**, add (or replace) the following URIs:

| Flow | URI to add |
|------|-----------|
| User login | `https://<your-railway-domain>/api/auth/google/callback` |
| Google Calendar | `https://<your-railway-domain>/api/scheduling/google/callback` |

4. Click **Save**.

### 7.2 Set matching env vars on Railway api-server

```
GOOGLE_LOGIN_REDIRECT_URI=https://<your-railway-domain>/api/auth/google/callback
GOOGLE_REDIRECT_URI=https://<your-railway-domain>/api/scheduling/google/callback
APP_BASE_URL=https://<your-railway-domain>
```

These override the `REPLIT_DOMAINS`-based auto-detection that the server uses in the Replit environment.

### 7.3 Authorized JavaScript origins

Add the dashboard's public domain under **Authorized JavaScript origins** if the Google Sign-In button is loaded from a separate frontend origin:

```
https://<your-dashboard-domain>
```

### 7.4 Required Google API scopes

The OAuth app must have the following scopes enabled in Google Cloud Console → **OAuth consent screen** → **Scopes**:

| Scope | Used for |
|-------|---------|
| `openid` | Login |
| `email` | Login — user identity |
| `profile` | Login — user display name |
| `https://www.googleapis.com/auth/calendar` | Google Calendar read/write |
| `https://www.googleapis.com/auth/calendar.events` | Creating/updating calendar events |

---

## 8. Post-migration smoke-test checklist

Run these checks after the first Railway deploy completes.

### 8.1 API server health

```bash
curl -f https://<your-railway-domain>/api/healthz
# Expected: 200 OK, JSON body { "status": "ok" }
```

### 8.2 Google login flow

1. Open the dashboard at `https://<your-dashboard-domain>`.
2. Click **Sign in with Google**.
3. Complete the Google consent screen.
4. Verify you land back on the dashboard and are logged in (your name/email appears in the top-right corner).
5. Check that `localStorage["voiceorch:session"]` is set in DevTools → Application.

### 8.3 Create an agent

1. Navigate to **Agents** → **New Agent**.
2. Fill in name, select ASR / LLM / TTS providers.
3. Save the agent.
4. Verify it appears in the Agents list with status `inactive`.
5. Toggle it to `active` and verify the status updates.

### 8.4 Make a test call (optional — requires telephony config)

1. Open an agent that has a telephony provider configured.
2. Initiate an outbound call or trigger an inbound webhook.
3. Verify a call record appears in **Calls Log**.
4. End the call and verify duration is computed correctly.

### 8.5 Call log

1. Navigate to **Calls Log**.
2. Verify the list loads without errors.
3. Click a call record and verify the transcript panel opens.

### 8.6 Scheduling public booking page

1. Create a calendar and event type in **Scheduling**.
2. Copy the public booking link (e.g. `https://<your-railway-domain>/book/<slug>`).
3. Open it in an incognito window (unauthenticated).
4. Verify available time slots appear.
5. Book a slot and verify the confirmation is shown.

### 8.7 Admin panel access

```bash
curl -H "x-admin-token: <ADMIN_TOKEN>" https://<your-railway-domain>/api/admin/users
# Expected: 200 OK, JSON array of users
```

### 8.8 Redis (if configured)

Check api-server startup logs for:
```
Upstash Redis client initialised
```

If you see `UPSTASH_REDIS_REST_URL / TOKEN not set — Redis session backing disabled`, the vars are missing or mis-set.

---

## Troubleshooting quick reference

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `relation does not exist` on startup | Drizzle migrations not applied | `pnpm --filter @workspace/db run push` with correct `DATABASE_URL` |
| Google login redirects to wrong URL | `GOOGLE_LOGIN_REDIRECT_URI` not set or mismatched | Set env var; add URI to Google Cloud Console |
| `503 Payment gateway not configured` | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` missing | Add Razorpay env vars or ignore if payments not needed |
| Gender service calls return 502 | `GENDER_SERVICE_URL` wrong or service not running | Check Railway internal hostname; verify gender-service is deployed |
| `unknown column exchange_code` | Migration 0012 not applied | Run `push` or apply migration SQL manually |
| Provider keys unreadable after `SESSION_SECRET` rotation | AES key derived from `SESSION_SECRET`; rotation breaks existing ciphertext | Never rotate `SESSION_SECRET` in prod; users must re-save keys if rotated |
| OTP emails not delivered | `BREVO_API_KEY` missing | Add key or use Gmail fallback (`GMAIL_USER` + `GMAIL_APP_PASSWORD`) |
