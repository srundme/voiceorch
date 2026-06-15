# Railway Deployment Guide — SnapServe / VoiceOrch

## Overview

Two Railway services required:

| Service | Source | Description |
|---------|--------|-------------|
| **snapserve-api** | Repo root (`Dockerfile`) | Express API + React dashboard SPA |
| **snapserve-gender** | `artifacts/gender-service` (`Dockerfile`) | Python FastAPI voice analysis |

Plus one **PostgreSQL** database add-on attached to `snapserve-api`.

---

## Step 1 — Create a Railway project

1. Go to [railway.app](https://railway.app) → **New Project**
2. Choose **Deploy from GitHub repo** → select this repository

---

## Step 2 — Add PostgreSQL

In your Railway project dashboard:

1. Click **+ New** → **Database** → **PostgreSQL**
2. After it provisions, copy the `DATABASE_URL` connection string from the **Variables** tab

---

## Step 3 — Configure the API service (snapserve-api)

Railway will detect the root `Dockerfile` automatically.

Go to the service → **Variables** and add:

### Required

| Variable | Value / Notes |
|----------|---------------|
| `DATABASE_URL` | Paste from the PostgreSQL service above |
| `SESSION_SECRET` | Random 64-character string (generate: `openssl rand -hex 32`) |
| `PORT` | `8080` |
| `NODE_ENV` | `production` |
| `FRONTEND_DIST_PATH` | `artifacts/dashboard/dist/public` |

### Google OAuth (login + calendar)

| Variable | Notes |
|----------|-------|
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |

Set your Google OAuth callback URL to:
`https://<your-railway-domain>/api/auth/google/callback`

### Admin

| Variable | Notes |
|----------|-------|
| `ADMIN_TOKEN` | Secret token for `/admin` access |

### Optional — AI / Telephony

| Variable | Notes |
|----------|-------|
| `GROQ_API_KEY` | Seeds the managed Qwen key at startup |
| `RAZORPAY_KEY_ID` | Razorpay payments |
| `RAZORPAY_KEY_SECRET` | Razorpay payments |
| `BREVO_API_KEY` | Email transactional |
| `CARTESIA_API_KEY` | Cartesia TTS |
| `SARVAM_API_KEY` | Sarvam ASR |
| `VOBIZ_AUTH_ID` | VoBiz telephony |
| `VOBIZ_AUTH_TOKEN` | VoBiz telephony |
| `UPSTASH_REDIS_REST_URL` | Redis rate limiting / caching |
| `UPSTASH_REDIS_REST_TOKEN` | Redis rate limiting / caching |
| `GMAIL_USER` | Gmail for scheduling email notifications |
| `GMAIL_APP_PASSWORD` | Gmail app password |

---

## Step 4 — Configure the Gender service (snapserve-gender)

1. In the same Railway project → **+ New** → **GitHub Repo** (same repo)
2. Set the **Root Directory** to `artifacts/gender-service`
3. Railway will detect the `Dockerfile` there automatically

Add one variable:

| Variable | Value |
|----------|-------|
| `PORT` | `5000` |

> **Note:** This service installs PyTorch (~2 GB). The first build takes 10–15 minutes.
> If you don't need voice analysis, you can skip deploying this service.

---

## Step 5 — Run database migrations

After the API service is deployed and running:

```bash
# Connect to Railway's Postgres and push the Drizzle schema
DATABASE_URL=<your-railway-db-url> pnpm --filter @workspace/db run push
```

Or use Railway's one-off command runner in the dashboard.

---

## Step 6 — Update your Google OAuth app

In Google Cloud Console, add your Railway domain to:
- **Authorised JavaScript origins**: `https://<your-domain>.railway.app`
- **Authorised redirect URIs**: `https://<your-domain>.railway.app/api/auth/google/callback`

---

## Architecture on Railway

```
Browser
  └──► snapserve-api  (:8080)
          ├── GET /          → serves React SPA (dashboard)
          ├── GET /api/*     → Express API routes
          └── WebSocket /api/ws/*  → telephony handlers

snapserve-gender  (:5000)
  └── POST /voice-analysis/gender
  └── WS   /voice-analysis/ws/gender

Railway PostgreSQL
  └── connected via DATABASE_URL
```

---

## Local test of the Docker build

```bash
# Build the image locally first to catch issues
docker build -t snapserve-api .

docker run -p 8080:8080 \
  -e DATABASE_URL="postgres://..." \
  -e SESSION_SECRET="test-secret-32-chars-minimum-here" \
  -e PORT=8080 \
  -e NODE_ENV=production \
  -e FRONTEND_DIST_PATH=artifacts/dashboard/dist/public \
  snapserve-api
```
