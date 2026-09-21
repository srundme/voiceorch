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

### Voice analysis (caller gender → Sir/Ma'am salutation)

| Variable | Value / Notes |
|----------|---------------|
| `GENDER_SERVICE_URL` | Internal hostname of the gender service. **Bare host only — no trailing slash, no path.** The API server appends `/voice-analysis/gender*` itself. Set to `http://gender-service.railway.internal:5000` (the service name must match the gender service's Railway name exactly). |

> If this is unset, the API server falls back to `http://localhost:5000`, which does NOT work across Railway containers — every detection silently fails and the `{caller_salutation}` placeholder resolves to a neutral greeting. The api-server logs the resolved URL + reachability at startup; verify it after deploy. You can also check `GET /api/admin/gender-service/diagnostics` (with `x-admin-token`) without placing a call.

### Optional — AI / Telephony

| Variable | Notes |
|----------|-------|
| `GROQ_API_KEY` | Seeds the managed Qwen key at startup |
| `AIC_SDK_LICENSE` | ai-coustics Quail Voice Focus (inbound NC). From developers.ai-coustics.com. Agent Noise Cancellation must be ON. |
| `AIC_MODEL_ID` | Optional; default `quail-vf-2.2-l-16khz` |
| `AEC3_ENABLED` | WebRTC AEC3 on VoBiz/PSTN (default on). Set `0` to disable. Browser webcall always skips (uses getUserMedia AEC). |
| `AEC3_STREAM_DELAY_MS` | Initial far-end→near-end delay hint (default `100`, clamped 40–800 ms). Adaptive updates only while render is active, skip double-talk (raw near energy), require corr ≥ 0.4, step ≤ 15 ms. |
| `AEC3_ADAPTIVE_DELAY` | Default on. Set `0` to freeze `AEC3_STREAM_DELAY_MS` (immediate rollback if delay tracking oscillates). Reset on every `mediaEpoch` (VoBiz media retarget). |
| `VOICE_CANARY` | Structured per-call canary logs (default on). Set `0` to silence. Every event includes `callId`, `mediaEpoch`, `carrier`, `route`, `wallTsMs`, `monoTsNs`. |
| `VOICE_CANARY_AUDIO` | When `1`, dump raw / post-AEC / post-Quail PCM snippets (~200 ms base64) on failed-call events. **Canary-only** — may contain personal speech. Cleared after dump; TTL via `VOICE_CANARY_AUDIO_TTL_MS` (default 60s, max 5 min). Off by default. |
| `VOICE_CANARY_AUDIO_TTL_MS` | Max age of held stage PCM before auto-drop (default `60000`). |
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

### Hard-condition canary (not quiet-room vanity)

Quiet rooms already clear STT without Quail/AEC — treat them as **regression only**. Prove value on hard conditions:

| Condition | How to run | Success signal |
|-----------|------------|----------------|
| Shop / AC / fan | Same script twice: NC on vs NC off | Fewer garbage STT finals with NC on |
| Speakerphone + light double-talk | Talk over agent briefly | `voice_canary_tts_duck` then barge or resolve; `ttsDuckAt` non-null on hard barge; false barge under ~2% |
| Reels / TV beside phone | Best-effort only (mono PSTN) | Fewer committed nonsense turns; residual misses OK to document |
| Quiet room | Baseline | Must not regress vs pre-change |

Filter Railway logs: `voice_canary_tts_duck`, `voice_canary_barge_in`, `voice_canary_room_crosstalk`, `aec3_delay_adjust`. After ~5 audio-dump calls set `VOICE_CANARY_AUDIO=0`.

---

## Step 4 — Configure the Gender service (snapserve-gender)

1. In the same Railway project → **+ New** → **GitHub Repo** (same repo)
2. Set the **Root Directory** to `artifacts/gender-service`
3. Railway will detect the `Dockerfile` there automatically

Add one variable:

| Variable | Value |
|----------|-------|
| `PORT` | `5000` |

Set the service **health check path** to `/voice-analysis/health` (liveness). Readiness of the wav2vec2 ML stack is a separate `/voice-analysis/ready` route.

After this service is up, set `GENDER_SERVICE_URL=http://gender-service.railway.internal:5000` on the **snapserve-api** service (see the Voice analysis section in Step 3).

> **Note:** This service installs PyTorch (~2 GB). The first build takes 10–15 minutes.
> Skipping this service (or leaving `GENDER_SERVICE_URL` unset on the API) disables caller gender detection — the `{caller_salutation}` placeholder will always resolve to a neutral greeting (no "Sir"/"Ma'am"). All other features keep working.

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
