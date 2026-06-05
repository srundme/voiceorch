# SnapServe Platform — The Complete Technical Guide

> **Last updated:** 2026-06-05
> **Version:** 1.0
> **Purpose:** Onboarding guide for developers, DevOps, and support engineers working on the SnapServe AI voice agent platform.

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [System Architecture](#2-system-architecture)
3. [Database Schema](#3-database-schema)
4. [Authentication & Authorization](#4-authentication--authorization)
5. [API Server & Routes](#5-api-server--routes)
6. [Frontend Artifacts](#6-frontend-artifacts)
7. [Voice Call Pipeline (Orchestration)](#7-voice-call-pipeline-orchestration)
8. [Provider System](#8-provider-system)
9. [Scheduling System](#9-scheduling-system)
10. [Campaign System](#10-campaign-system)
11. [Billing & Payments](#11-billing--payments)
12. [Knowledge Base](#12-knowledge-base)
13. [Deployment & Operations](#13-deployment--operations)
14. [Debugging Guide](#14-debugging-guide)
15. [Common Issues & Quick Fixes](#15-common-issues--quick-fixes)

---

## 1. Executive Overview

**SnapServe** is a multi-tenant AI voice agent orchestration SaaS platform. Users create AI voice agents that handle real-time phone conversations using a pipeline of:
- **STT** (Speech-to-Text) — transcribes caller speech
- **LLM** (Large Language Model) — generates intelligent responses
- **TTS** (Text-to-Speech) — converts responses to spoken audio
- **Telephony** — connects the agent to real phone numbers

The platform supports **BYOP** (Bring Your Own Provider) — users supply their own API keys for each provider, or use **Managed Mode** where the platform operator provides keys.

### Key Features
- Real-time voice conversations via web browser (WebRTC/WebSocket) and telephony (Twilio, Plivo, Vobiz)
- Campaign management for outbound calling at scale
- Scheduling/booking system with Google Calendar integration
- Knowledge base (RAG) for agent grounding
- Gender detection for personalized salutations
- Call transfers, voicemail detection, IVR/DTMF
- Wallet-based billing with Razorpay integration
- Multi-tenant dashboard and admin panel

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Dashboard  │  │   Admin     │  │   Landing   │  │  Widget JS  │     │
│  │   (React)   │  │   (React)   │  │   (React)   │  │  (Embed)    │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │                │             │
│         └────────────────┴────────────────┴────────────────┘             │
│                                    │                                     │
│                              Replit Proxy                               │
│                         (routes by path prefix)                          │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────┐
│                         API SERVER (Express)                          │
│  ┌─────────────────────────────────┴────────────────────────────────┐   │
│  │  Routes: /api/agents, /api/calls, /api/providers, /api/auth,    │   │
│  │          /api/scheduling, /api/campaigns, /api/admin, ...       │   │
│  │                                                                 │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │   │
│  │  │  Pipeline   │  │   Webcall   │  │  Campaign   │            │   │
│  │  │  (Telephony)│  │  (Browser)  │  │   Engine    │            │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │   │
│  │         │                │                │                   │   │
│  │  ┌──────┴────────────────┴────────────────┴────────────────┐    │   │
│  │  │              Orchestration Layer                        │    │   │
│  │  │  (STT adapters, LLM adapters, TTS adapters, Tools)        │    │   │
│  │  └────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                          │                                            │
│  ┌───────────────────────┼────────────────────────────────────────┐   │
│  │  DATA LAYER           │                                        │   │
│  │  ┌─────────┐  ┌──────┴────┐  ┌──────────┐  ┌────────────┐     │   │
│  │  │ Postgres│  │  Redis    │  │ Object   │  │  External  │     │   │
│  │  │  (Drizzle)│ (Sessions) │  │ Storage  │  │  APIs      │     │   │
│  │  └─────────┘  └─────────┘  └──────────┘  └────────────┘     │   │
│  └──────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────┘
```

### 2.2 Monorepo Structure

```
workspace/
├── artifacts/
│   ├── api-server/          # Express API (port 8080, served at /api)
│   ├── dashboard/           # React SPA (port 23183, served at /)
│   ├── admin/               # React SPA (admin panel)
│   ├── landing/             # React SPA (marketing site)
│   ├── gender-service/      # Python voice analysis (uvicorn)
│   └── mockup-sandbox/      # Component preview server
├── lib/
│   ├── api-spec/            # OpenAPI spec (openapi.yaml)
│   ├── api-client-react/    # Auto-generated React Query hooks
│   ├── api-zod/             # Auto-generated Zod schemas
│   └── db/                  # Drizzle schema + DB connection
├── scripts/                 # Utility scripts
├── pnpm-workspace.yaml      # Workspace package discovery
└── package.json             # Root task orchestration
```

### 2.3 Key Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `SESSION_SECRET` | JWT signing key (HS256) | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth app ID | Yes (for login + calendar) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth app secret | Yes (for login + calendar) |
| `GROQ_API_KEY` | Seeds `managed_qwen_key` at startup | Yes |
| `ADMIN_TOKEN` | Admin panel auth (x-admin-token) | Yes |
| `RAZORPAY_KEY_ID` | Payment gateway key | Yes |
| `RAZORPAY_KEY_SECRET` | Payment gateway secret | Yes |
| `GMAIL_USER` | SMTP for booking emails | Optional |
| `GMAIL_APP_PASSWORD` | SMTP password | Optional |
| `UPSTASH_REDIS_REST_URL` | Redis session store | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | Redis token | Yes |

---

## 3. Database Schema

### 3.1 Core Tables

#### `users` — Platform Users
```sql
id: serial (PK)
clerk_id: text (unique) — Google account "sub" (repurposed from Clerk)
email: text
name: text
wallet_balance_cents: integer (default 0)
free_credits_granted: boolean (default false)
auto_pay_enabled: boolean (default false)
auto_pay_threshold_cents: integer (default 100)
auto_pay_amount_cents: integer (default 1000)
concurrent_limit: integer (default 2)
onboarding_completed: boolean (default false)
onboarding_data: jsonb
preferences: jsonb ({ theme: "light" | "dark" | "system" })
created_at: timestamp
updated_at: timestamp
```

#### `agents` — Voice Agent Configuration
```sql
id: serial (PK)
user_id: text (FK → users.clerk_id)
name: text
status: text ("active" | "inactive")
prompt: text
language: text (default "en")
asr_provider: text (STT provider name)
llm_provider: text (LLM provider name)
tts_provider: text (TTS provider name)
tts_voice: text
telephony_provider: text
telephony_number: text
config: jsonb (AgentConfig — see below)
created_at: timestamp
updated_at: timestamp
```

**AgentConfig** (JSONB) contains:
- **LLM Tab:** `maxTokens`, `topP`, `minP`, `topK`, `presencePenalty`, `frequencyPenalty`, `requestJsonResponse`, `guardrailRoutes`
- **Audio Tab:** `secondaryLanguage`, `secondaryLanguages`, `ttsStream`, `ttsSamplingRate`, `ttsEncoding`, `ttsAudioFormat`
- **Engine Tab:** `wordsForInterruption`, `incrementalDelay`, `backchannelingStartDelay`, `ambientNoiseEnabled`, `ambientNoiseTrack`
- **Call Tab:** `hangupAfterLlmCall`, `callCancellationPrompt`, `voicemailDetection`, `voicemailAction`, `voicemailMessage`, `machineDetectionMode`, `recordingEnabled`, `recordingFormat`, `ivrEnabled`, `ivrGreeting`, `ivrOptions`, `queueEnabled`, `queueMaxConcurrent`, `queueWaitSeconds`, `queueHoldMusicUrl`, `schedulingGuardrails`, `callStartHour`, `callEndHour`
- **Analytics Tab:** `summarizationEnabled`, `summarizationPrompt`, `dispositionsV2`
- **Inbound Tab:** `inboundLimit`, `disallowUnknownNumbers`, `whitelistNumbers`, `callMemoryEnabled`, `callMemorySourceType`, `callMemorySourceUrl`, `callMemoryAuthToken`
- **WhatsApp Tab:** `whatsappProvider`, `whatsappCredentials`, `whatsappOutcomeMessages`
- **VAD/Barge-in:** `vadSilenceMs`, `bargeInEnabled`, `bargeInEnergyThreshold`, `bargeInMinFrames`, `bargeInEchoGraceMs`
- **Post-call:** `successCriteria`
- **Gender Detection:** `genderDetectionEnabled`, `genderDetectionProvider`, `genderDetectionMaleSalutation`, `genderDetectionFemaleSalutation`
- **Prompt Variables:** `promptVariables` (user-defined key-value pairs resolved at call start)
- **Webhook:** `webhookSecret` (HMAC secret)

#### `calls` — Call Logs
```sql
id: serial (PK)
user_id: text
agent_id: integer (FK → agents.id, cascade)
status: text ("pending" | "in_progress" | "completed" | "failed" | "cancelled")
to_number: text
from_number: text
duration_seconds: integer
transcript: text
recording_url: text
call_summary: text
error_message: text
execution_id: text
metadata: text
stt_latency_ms: integer
llm_latency_ms: integer
tts_first_chunk_ms: integer
cost_cents: integer
disposition_result: json
success_evaluation: text
transfer_type: text ("warm" | "cold")
transfer_target: text
amd_result: text ("human" | "machine" | "unknown")
created_at: timestamp
ended_at: timestamp
```

#### `providers` — User API Keys
```sql
id: serial (PK)
user_id: text
provider_type: text ("asr" | "llm" | "tts" | "telephony")
provider_name: text (e.g., "deepgram", "openai", "elevenlabs", "twilio")
api_key: text (encrypted at rest with AES-256-GCM)
is_active: boolean (default true)
extra_config: text
```

Keys are encrypted at rest using `SESSION_SECRET` as the key derivation base. The `decryptKey()` function in `lib/crypto.ts` handles transparent decryption. Keys added before encryption was introduced pass through unchanged.

#### `platform_settings` — Platform-wide Configuration
```sql
key: text (PK)
value: text
updated_at: timestamp
```

**Managed keys stored here:**
- `managed_qwen_key` — Groq/Qwen LLM
- `managed_gemini_key` — Google Gemini
- `managed_deepgram_key` — Deepgram STT
- `managed_sarvam_key` — Sarvam STT
- `managed_cartesia_key` — Cartesia TTS
- `managed_openai_key` — OpenAI
- `managed_groq_key` — Groq
- `managed_anthropic_key` — Anthropic
- `managed_mistral_key` — Mistral

### 3.2 Scheduling Tables

#### `scheduling_calendars` — Agent Calendars
```sql
id: serial (PK)
agent_id: integer (FK → agents.id, cascade)
user_id: text
name: text (default "My Calendar")
timezone: text (default "UTC")
host_email: text
additional_hosts: text[]
google_calendar_connection_id: uuid
is_active: boolean
```

#### `event_types` — Meeting Types
```sql
id: serial (PK)
calendar_id: integer (FK → scheduling_calendars.id, cascade)
user_id: text
name: text
slug: text (unique)
description: text
duration_minutes: integer (default 30)
buffer_before_mins: integer (default 0)
buffer_after_mins: integer (default 0)
confirmation_mode: text ("instant" | "manual")
max_bookings_per_slot: integer (default 1)
enable_google_meet: boolean
is_active: boolean
```

#### `availability_schedules` — Weekly Availability
```sql
id: serial (PK)
calendar_id: integer (FK → scheduling_calendars.id, cascade)
day_of_week: integer (0=Sunday, 6=Saturday)
start_time: text ("HH:MM")
end_time: text ("HH:MM")
is_active: boolean
```

#### `availability_overrides` — Date-specific Overrides
```sql
id: serial (PK)
calendar_id: integer (FK → scheduling_calendars.id, cascade)
date: text ("YYYY-MM-DD")
start_time: text
end_time: text
is_unavailable: boolean (default false)
reason: text
```

#### `bookings` — Confirmed Appointments
```sql
id: serial (PK)
event_type_id: integer (FK → event_types.id, cascade)
calendar_id: integer (FK → scheduling_calendars.id, cascade)
user_id: text
start_time: text (ISO 8601)
end_time: text (ISO 8601)
attendee_name: text
attendee_email: text
attendee_phone: text
status: text ("confirmed" | "cancelled" | "rescheduled")
google_event_id: text
notes: text
created_at: timestamp
updated_at: timestamp
```

#### `google_calendar_connections` — OAuth Connections
```sql
id: uuid (PK, default random)
user_id: text
email: text
access_token: text
refresh_token: text
token_expiry: timestamp
needs_reconnect: boolean (default false)
reconnect_reason: text
```

Tokens are encrypted at rest via `encryptKey`/`decryptKey`. Auto-refresh on expiry.

### 3.3 Campaign Tables

#### `campaigns` — Outbound Campaigns
```sql
id: serial (PK)
user_id: text
name: text
description: text
agent_id: integer (FK → agents.id, set null)
status: text ("draft" | "active" | "paused" | "completed")
webhook_token: text (unique)
field_mappings: json (default { phone: "phone" })
from_number: text
call_delay_seconds: integer (default 5)
max_attempts: integer (default 1)
retry_delay_minutes: integer (default 60)
total_leads: integer (default 0)
called_leads: integer (default 0)
concurrent_call_limit: integer (default 20)
is_active: boolean
```

#### `campaign_batches` — Lead Batches
```sql
id: serial (PK)
campaign_id: integer (FK → campaigns.id, cascade)
name: text
status: text ("draft" | "scheduled" | "running" | "completed" | "cancelled")
lead_source: text ("csv" | "meta" | "webhook")
scheduled_start_at: timestamp
scheduled_end_at: timestamp
total_leads: integer
called_leads: integer
field_mappings: json
call_delay_seconds: integer
max_attempts: integer
retry_delay_minutes: integer
timezone: text
business_hours_start: integer
business_hours_end: integer
max_daily_calls: integer
duplicate_policy: text ("ignore" | "skip" | "reject_with_report")
```

#### `campaign_leads` — Individual Leads
```sql
id: serial (PK)
campaign_id: integer (FK → campaigns.id, cascade)
batch_id: integer (FK → campaign_batches.id, cascade)
phone: text
name: text
email: text
status: text ("pending" | "calling" | "completed" | "failed" | "no_answer" | "voicemail" | "dnc")
metadata: json
disposition: text
outcome: text ("pending" | "booking_created" | "transfer_completed" | "callback_requested" | "interest_confirmed" | "no_contact" | "dnc_blocked" | "failed")
attempts: integer (default 0)
last_attempted_at: timestamp
scheduled_callback_at: timestamp
```

### 3.4 Other Tables

| Table | Purpose |
|-------|---------|
| `wallet_transactions` | Razorpay top-ups, call charges |
| `knowledge_sources` | KB document sources per agent |
| `knowledge_entries` | Individual KB entries (full-text search) |
| `agent_templates` | Pre-built agent configurations |
| `prompt_templates` | Reusable prompt templates |
| `call_transfers` | Warm/cold transfer logs |
| `webhook_endpoints` | User-defined webhook URLs |
| `phone_numbers` | Purchased/verified phone numbers |
| `usage_events` | Granular per-call usage tracking |
| `admin_alerts` | Health monitoring alerts |
| `activity_logs` | User activity tracking |
| `platform_listed_voices` | Curated TTS voice catalog |
| `provider_pricing` | Provider cost rates |
| `provider_minute_rates` | Reseller markup rates |
| `provider_allocations` | Provider key allocation tracking |
| `scheduled_callbacks` | Retry scheduling for campaigns |
| `caller_profiles` | Per-caller memory and history |
| `verified_destinations` | DNC-safe destination whitelist |
| `api_keys` | User API keys for programmatic access |
| `ambient_sounds` | Custom ambient noise uploads |
| `kyc` | KYC verification records |

---

## 4. Authentication & Authorization

### 4.1 End-User Authentication (Google OAuth)

**No Clerk.** The platform uses standalone Google OAuth.

**Flow:**
1. User clicks "Sign in with Google" on dashboard
2. Frontend redirects to `GET /api/auth/google/connect`
3. Server redirects to Google's consent screen with `redirect_uri` derived from request
4. User grants consent, Google redirects to `GET /api/auth/google/callback`
5. Server exchanges code for Google profile (sub, email, name)
6. Server creates a **platform session token** (HS256 JWT, 30-day TTL, signed with `SESSION_SECRET`)
7. Token is delivered via URL fragment: `https://snapserve.ai/app#session=<jwt>`
8. Frontend captures token on load and stores in `localStorage["voiceorch:session"]`
9. All subsequent API calls send `Authorization: Bearer <jwt>`

**Session token payload:**
```json
{ "sub": "google-sub-id", "email": "user@example.com", "name": "User Name" }
```

**Middleware:**
- `attachSession` validates JWT and sets `req.clerkUserId` (= Google sub) + `req.sessionPayload`
- `getAuth(req)` shim (`lib/auth-compat.ts`) returns `{ userId: req.clerkUserId }` for backward compatibility

**User provisioning:** First-time users are auto-created with:
- Email, name from Google profile
- API key + org key
- $5 welcome credit (`freeCreditsGranted: true`)
- Concurrent limit of 2

### 4.2 Admin Authentication

- `x-admin-token` header required on all `/admin/*` routes
- Token value is the `ADMIN_TOKEN` secret
- Admin routes bypass user provisioning middleware

### 4.3 Public Routes (No Auth)

- `GET /api/healthz` — Health check
- `GET /api/voices` — Public voice catalog
- `GET /api/utils/*` — Utility endpoints
- `POST /api/campaign/webhook/*` — Campaign lead ingestion
- `GET /api/scheduling/public/*` — Public booking pages
- `GET /api/auth/google/*` — Login flow
- `GET /api/scheduling/google/callback` — Calendar OAuth callback

---

## 5. API Server & Routes

### 5.1 Router Mounting Order (Critical)

File: `artifacts/api-server/src/routes/index.ts`

Order matters because Express routes are matched first-match-wins:

```
// 1. Admin routes (no user provisioning)
router.use(ambientSoundsRouter);  // MUST be before adminRouter — has own query-token auth
router.use(adminRouter);
router.use(adminVoicesRouter);
router.use(adminUsageRouter);
router.use(adminPromptTemplatesRouter);

// 2. Public routes (no auth)
router.use(campaignWebhookRouter);  // Campaign lead ingestion
router.use(authRouter);             // Google login
router.use(voicesRouter);           // Public voice catalog
router.use(utilsRouter);            // Utilities

// 3. Authenticated routes (after provisionUser)
router.use(provisionUser);          // Ensures user exists in DB
router.use(ambientSoundsUserRouter);
router.use(healthRouter);
router.use(agentsRouter);
router.use(callsRouter);
router.use(providersRouter);
router.use(analyticsRouter);
router.use(webhooksRouter);
router.use(widgetRouter);
router.use(knowledgeBaseRouter);
router.use(walletRouter);
router.use(accountRouter);
router.use(activityLogsRouter);
router.use(phoneNumbersRouter);
router.use(webhookEndpointsRouter);
router.use(agentTemplatesRouter);
router.use(onboardingRouter);
router.use(wizardRouter);
router.use(campaignsRouter);
router.use(campaignBatchesRouter);
router.use(campaignLeadsRouter);
router.use(campaignAnalyticsRouter);
router.use(campaignOpsRouter);
router.use(commandCenterRouter);
router.use(liveQueueRouter);
router.use(campaignCallbacksRouter);
router.use(campaignIncomingRouter);
router.use(campaignBookingsRouter);
router.use(campaignTransfersRouter);
router.use(batchWorkspaceRouter);
router.use(leadWorkspaceRouter);
router.use(platformAnalyticsRouter);
router.use(searchRouter);
router.use(agentVariablesRouter);
router.use(batchImportRunsRouter);
router.use(schedulingRouter);
router.use(kycRouter);
router.use(assistantRouter);
router.use(usageMeRouter);
router.use(userApiKeysRouter);
router.use(metaRouter);
router.use(callTransfersRouter);
router.use(billingRouter);
router.use(testToolRouter);
router.use(webcallNotifyRouter);
router.use(storageRouter);
```

### 5.2 Route Categories

| Category | Routes | File |
|----------|--------|------|
| **Auth** | `/api/auth/google/*` | `routes/auth.ts` |
| **Agents** | CRUD, toggle, analytics | `routes/agents.ts` |
| **Calls** | List, end, transfer, recordings | `routes/calls.ts` |
| **Providers** | CRUD API keys (encrypted) | `routes/providers.ts` |
| **Analytics** | Dashboard stats, call volume | `routes/analytics.ts` |
| **Webhooks** | Custom webhook endpoints | `routes/webhooks.ts` |
| **Widget** | Embed script generation | `routes/widget.ts` |
| **Knowledge Base** | Sources, entries, retrieval | `routes/knowledge-base.ts` |
| **Wallet** | Top-up, balance, transactions | `routes/wallet.ts` |
| **Account** | Profile, settings | `routes/account.ts` |
| **Phone Numbers** | Purchase, verify, manage | `routes/phone-numbers.ts` |
| **Scheduling** | Calendars, event types, bookings, slots, Google OAuth | `routes/scheduling/*` |
| **Campaigns** | Campaigns, batches, leads, analytics | `routes/campaigns.ts`, `routes/campaign-*` |
| **Admin** | Overview, alerts, usage, managed keys, voices | `routes/admin.ts`, `routes/admin-*` |
| **Ambient Sounds** | Upload, play, list | `routes/ambient-sounds.ts` |
| **Transfers** | Warm/cold transfers | `routes/call-transfers.ts` |
| **Voice Catalog** | Public voice listing | `routes/voices.ts` |

### 5.3 API Contract (OpenAPI)

**Source of truth:** `lib/api-spec/openapi.yaml`

All API contracts are defined in OpenAPI first, then auto-generated:

```bash
# Generate React Query hooks and Zod schemas
pnpm --filter @workspace/api-spec run codegen

# After codegen, typecheck
pnpm run typecheck:libs
```

Generated files:
- `lib/api-client-react/src/generated/` — React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — Zod schemas for server validation (do not edit)

---

## 6. Frontend Artifacts

### 6.1 Dashboard (`artifacts/dashboard`)

**Routes (Wouter):**
| Path | Component | Description |
|------|-----------|-------------|
| `/` | `LandingPage` | Public landing |
| `/app` | `Dashboard` | Overview stats |
| `/app/agents` | `AgentsList` | Agent list |
| `/app/agents/new` | `AgentNew` | Create agent |
| `/app/agents/:id` | `AgentDetail` | Agent detail |
| `/app/agents/:id/edit` | `AgentEdit` | Edit agent |
| `/app/calls` | `CallsList` | Call history |
| `/app/calls/:id` | `CallDetail` | Call transcript |
| `/app/providers` | `ProvidersList` | API keys |
| `/app/settings` | `Settings` | Account settings |
| `/app/knowledge-base` | `KnowledgeBasePage` | KB management |
| `/app/wallet` | `WalletPage` | Billing |
| `/app/activity` | `ActivityPage` | Activity logs |
| `/app/phone-numbers` | `PhoneNumbersPage` | Numbers |
| `/app/webhooks` | `WebhooksPage` | Webhook endpoints |
| `/app/analytics` | `AnalyticsPage` | Analytics |
| `/app/campaigns` | `CampaignsPage` | Campaign list |
| `/app/campaigns/:id` | `CampaignDetailPage` | Campaign detail |
| `/app/campaigns/:id/batches/:batchId` | `BatchDetailPage` | Batch detail |
| `/app/campaigns/batch-wizard` | `BatchWizardPage` | Batch creation |
| `/app/campaigns/:id/leads/:leadId` | `CampaignLeadProfilePage` | Lead profile |
| `/app/scheduling` | `SchedulingPage` | Scheduling overview |
| `/app/scheduling/calendars` | `SchedulingCalendarsPage` | Calendars |
| `/app/scheduling/event-types` | `SchedulingEventTypesPage` | Event types |
| `/app/scheduling/event-types/:id` | `SchedulingEventTypeDetailPage` | Event type detail |
| `/app/scheduling/availability` | `SchedulingAvailabilityPage` | Availability |
| `/app/scheduling/bookings` | `SchedulingBookingDetailPage` | Bookings |
| `/app/usage` | `UsagePage` | Usage tracking |
| `/app/kyc` | `KycPage` | KYC |
| `/app/api-keys` | `ApiKeysPage` | API keys |
| `/app/command-center` | `CommandCenterPage` | Real-time monitoring |
| `/app/transfers` | `TransfersPage` | Transfers |
| `/app/voices` | `VoicesPage` | Voice catalog |
| `/app/test-simulator` | `TestSimulatorPage` | Test simulator |
| `/app/meta-leads` | `MetaLeadsPage` | Meta leads |
| `/app/onboarding` | `OnboardingPage` | First-time setup |
| `/book/:slug` | `PublicBookingPage` | Public booking (no auth) |
| `/book/cancel` | `CancelBookingPage` | Cancel booking |
| `/book/reschedule` | `RescheduleBookingPage` | Reschedule booking |
| `/sign-in` | `LandingPage` | Login redirect |

**Auth flow:**
- `AuthProvider` wraps the app
- `AuthTokenSync` sets `getToken()` from `useAuth()`
- `setAuthTokenGetter` configures API client to use Bearer token
- Token stored in `localStorage["voiceorch:session"]`
- `SignedIn` / `SignedOut` gates routes

### 6.2 Admin (`artifacts/admin`)

**Routes:**
- `/usage` — Cross-user usage aggregation
- `/managed-keys` — Platform-wide provider keys
- `/finance` — Revenue tracking
- `/growth` — User metrics
- `/health` — System health
- `/overview` — Admin dashboard
- `/alerts` — Alert management
- `/prompt-templates` — Prompt templates
- `/voices` — Voice catalog management

### 6.3 Landing (`artifacts/landing`)

Marketing site with product showcase.

---

## 7. Voice Call Pipeline (Orchestration)

### 7.1 Two Entry Points

**File: `artifacts/api-server/src/orchestration/pipeline.ts`** — Telephony (Twilio/Plivo/Vobiz)
**File: `artifacts/api-server/src/orchestration/telephony/webcall.ts`** — Browser (WebSocket/WebRTC)

> **Critical:** These are fully separate implementations. Any feature added to one must be duplicated in the other. See memory: `webcall-pipeline-split.md`.

### 7.2 Telephony Pipeline (Twilio/Plivo/Vobiz)

**Flow:**
1. **Webhook entry** — Provider sends incoming call webhook to `/api/webhooks/:provider`
2. **Session init** — `session.ts` creates a `Pipeline` instance with agent config, provider keys, tools
3. **Audio loop** — Receives μ-law audio chunks (8kHz, 20ms) from provider
4. **VAD** — `hasSpeechEnergy()` detects speech, `VAD_SILENCE_MS` (250ms) silence before STT flush
5. **STT** — Streams to Deepgram/AssemblyAI; receives partial/final transcripts
6. **Barge-in** — `BARGE_IN_ENERGY_THRESHOLD` (1200) while agent is speaking; `BARGE_IN_ECHO_GRACE_MS` (600ms) after TTS starts
7. **LLM** — Forwards transcript to OpenAI/Anthropic/DeepSeek/Gemini; streaming tokens
8. **Tools** — LLM can trigger native tools (booking, KB search, availability) or external webhooks
9. **TTS** — Streams LLM tokens to Cartesia/ElevenLabs/Azure; `TTS_STREAM_TIMEOUT_MS` (8000ms) abort
10. **Audio out** — Encodes μ-law chunks, sends back to telephony provider
11. **Call end** — `PATCH /api/calls/:id/end` computes duration, updates metrics

**Key constants:**
| Constant | Value | Purpose |
|----------|-------|---------|
| `VAD_SILENCE_MS` | 250 | Silence before STT flush |
| `MIN_SPEECH_BYTES` | 3200 | ~200ms @ 8kHz — skip noise bursts |
| `VAD_THRESHOLD` | 100 | RMS threshold for speech detection |
| `BARGE_IN_ENERGY_THRESHOLD` | 1200 | Interrupt threshold while agent speaking |
| `BARGE_IN_ECHO_GRACE_MS` | 600 | Suppress barge-in after TTS starts |
| `TTS_STREAM_TIMEOUT_MS` | 8000 | Abort TTS if no data within 8s |
| `CHUNK_SIZE_MULAW` | 160 | 20ms @ 8kHz μ-law playback |
| `STREAM_ACCUM_BYTES` | 640 | 20ms @ 16kHz PCM TTS buffering |
| `HANDOFF_SILENCE_MS` | 3000 | Sustained silence = phone handoff |

### 7.3 Webcall Pipeline (Browser)

**Flow:**
1. **WebSocket connection** — Client connects to `/ws/call` or similar
2. **Session init** — Same as telephony but with WebSocket transport
3. **Audio loop** — Receives 16kHz PCM from browser (ScriptProcessorNode, 2048 samples = 128ms frame)
4. **Downsample** — `downsample16to8()` converts to 8kHz for STT
5. **VAD** — `SPEECH_RMS_THRESHOLD` (400) for normal VAD; `BARGE_IN_RMS` (800) for barge-in
6. **Barge-in** — `BARGE_IN_MIN_FRAMES` (3) minimum; `WEBCALL_FRAME_MS` (128ms per frame)
7. **Word gate** — `wordsForInterruption` (default 2) — minimum words before barge-in triggers
8. **STT** — Same adapters as telephony (Deepgram streaming, Sarvam streaming, others batch)
9. **STT Fallback** — If streaming STT closes, reconnects with fallback provider from `asrFallbackProviders`
10. **LLM** — Same streaming LLM
11. **TTS** — Same TTS adapters
12. **Upsample** — `upsample8to16()` converts TTS output back to 16kHz
13. **Volume gain** — `TTS_VOLUME_GAIN` (1.5) amplitude multiplier
14. **Audio tail** — `AUDIO_TAIL_SILENCE_MS` (300) + `TTS_TAIL_SILENCE_MS` (150) prevents cutoffs

**Key constants:**
| Constant | Value | Purpose |
|----------|-------|---------|
| `VAD_SILENCE_MS` | 450 | Longer silence before STT flush (browser) |
| `SPEECH_RMS_THRESHOLD` | 400 | Normal VAD threshold |
| `BARGE_IN_RMS` | 800 | Barge-in threshold (higher than normal) |
| `BARGE_IN_MIN_FRAMES` | 3 | Minimum frames for barge-in |
| `WEBCALL_FRAME_MS` | 128 | Browser frame duration |
| `BARGE_IN_ECHO_GRACE_MS` | 700 | After TTS starts |
| `BARGE_IN_END_GRACE_MS` | 600 | After last TTS chunk |
| `TTS_VOLUME_GAIN` | 1.5 | PCM amplitude multiplier |
| `MIN_PCM_BYTES` | 3200 | ~100ms @ 16kHz minimum |
| `AUDIO_CHUNK_BYTES` | 1280 | 40ms per WS frame |
| `HANDOFF_SILENCE_MS` | 3000 | Phone handoff detection |
| `AUDIO_TAIL_SILENCE_MS` | 300 | Buffer drain before "listening" |
| `TTS_TAIL_SILENCE_MS` | 150 | Prevent last-word cutoff |

### 7.4 STT (Speech-to-Text) Adapters

**File: `artifacts/api-server/src/orchestration/adapters/stt/index.ts`**

**Supported providers:**
| Provider | Streaming | Batch | Notes |
|----------|-----------|-------|-------|
| Deepgram | Yes | Yes | Native streaming, `noise_reduction` param |
| Sarvam | Yes | Yes | Streaming via WebSocket, `endOfTurnTimeout` |
| Whisper | No | Yes | OpenAI API |
| Azure | No | Yes | Azure Speech API |

**STT Fallback Logic:**
- Streaming path: If streaming STT closes unexpectedly, reconnects with next fallback provider
- Batch path: If batch STT errors, iterates through `asrFallbackProviders` in order
- Language chain: `asrLanguage` → `agent.language` → provider default

**STT Panel Settings (Dashboard):**
- `backgroundDenoising` — Deepgram `noise_reduction` (Deepgram only)
- `smartEndpointing` — Deepgram `smart_format` / Sarvam native
- `asrFallbackProviders` — Array of fallback provider names

### 7.5 LLM Adapters

**Supported providers:**
| Provider | Streaming | Notes |
|----------|-----------|-------|
| OpenAI | Yes | GPT-4o, GPT-3.5 |
| DeepSeek | Yes | DeepSeek-V3 |
| Anthropic | Yes | Claude 3.5 Sonnet |
| Mistral | Yes | Mistral Large |
| Cohere | Yes | Command R+ |
| Gemini (Google) | Yes | Gemini 2.5 Flash |
| Qwen (Groq) | Yes | Managed key fallback |

**LLM system prompt injection:**
- `buildDatetimeInjection()` — Adds current date/time to system prompt
- `retrieveKbContext()` — Injects up to 50 KB entries into context
- `injectCallerMemory()` — Injects caller profile/history

### 7.6 TTS Adapters

**Supported providers:**
| Provider | Streaming | Notes |
|----------|-----------|-------|
| ElevenLabs | Yes | High quality, latency varies |
| Cartesia | Yes | Sonic model, low latency |
| OpenAI | Yes | TTS-1 |
| AWS Polly | Yes | Standard + Neural |
| Azure | Yes | Neural voices |
| Deepgram | Yes | Aura model |
| Sarvam | Yes | Indian languages |

### 7.7 Ambient Sounds

**File: `artifacts/api-server/src/orchestration/ambient.ts`**

- 7 built-in procedural tracks (cafe, rain, office, etc.)
- `TRACK_PARAMS` defines per-track parameters
- `normalizeLoopRms()` — RMS-normalizes all loops to `TARGET_LOOP_RMS` (~5000, ~-16 dBFS)
- `SILENCE_VOL` (0.28) during agent silence, `SPEECH_VOL` (0.14) during agent speech
- Upload support via `FileAmbientNoiseStream` (UUID-based PCM files)
- Audio endpoint: `GET /admin/ambient-sounds/:id/audio?token=...` (query param for `<audio>` elements)

### 7.8 Gender Detection

- `GenderDetector` — Basic rule-based
- `GenderDetectorML` — ML-based classifier
- `GenderDetectorMLv2` — Improved ML classifier
- Fires early in call (first 32768 bytes of audio)
- Sets `resolvedSalutation` ("Sir"/"Ma'am") based on detected gender
- Configurable via `genderDetectionEnabled`, `genderDetectionProvider`, `genderDetectionMaleSalutation`, `genderDetectionFemaleSalutation`

### 7.9 Call Memory

- `loadCallerProfile()` — Loads per-caller history from `caller_profiles` table
- `injectCallerMemory()` — Injects past call context into LLM prompt
- `updateCallerProfile()` — Updates profile after call ends
- `detectCallbackRequest()` — Detects "call me back" requests

---

## 8. Provider System

### 8.1 BYOP vs Managed Mode

**BYOP (Bring Your Own Provider):**
- User adds their own API keys in the Providers page
- Keys are encrypted at rest (`AES-256-GCM`, key derived from `SESSION_SECRET`)
- Only last-4-char hint shown in UI
- User pays provider directly for usage

**Managed Mode:**
- Platform operator provides keys via Admin Panel → Managed Keys
- Keys stored in `platform_settings` table
- User pays the platform for usage
- Managed key map: `session.ts` and `webcall.ts` both define `MANAGED` record

### 8.2 Provider Key Resolution

```
1. Check if agent mode is "managed"
2. If managed: use platform key (ignore user key)
3. If BYOP: check user's provider key
4. If user has no key: fall back to platform key
5. If no key found: call fails with provider error
```

### 8.3 Supported Provider Types

| Type | Providers | Notes |
|------|-----------|-------|
| **ASR (STT)** | Deepgram, Sarvam, Whisper, Azure | Streaming: Deepgram, Sarvam only |
| **LLM** | OpenAI, DeepSeek, Anthropic, Mistral, Cohere, Gemini, Qwen | All support streaming |
| **TTS** | ElevenLabs, Cartesia, OpenAI, AWS Polly, Azure, Deepgram, Sarvam | All support streaming |
| **Telephony** | Twilio, Plivo, Vobiz | Vobiz for India, Twilio/Plivo for global |

---

## 9. Scheduling System

### 9.1 Booking Flow

1. **Public page** — User visits `/book/:slug` (no auth required)
2. **Event type lookup** — `GET /api/scheduling/public/event-types/:slug`
3. **Slot computation** — `GET /api/scheduling/public/slots?eventTypeId=...&date=...`
   - `slot-engine.ts` intersects `availability_schedules` + `availability_overrides` + existing `bookings`
   - Respects `buffer_before_mins`, `buffer_after_mins`, `max_bookings_per_slot`
   - `date-fns-tz` aware timezone handling
4. **Booking** — `POST /api/scheduling/public/bookings`
   - `pg_try_advisory_xact_lock` prevents double-booking
   - Creates Google Calendar event if connected
   - Sends email notification if `GMAIL_USER` + `GMAIL_APP_PASSWORD` configured
   - Dispatches webhook if configured
5. **Confirmation** — Email sent to attendee + host

### 9.2 Google Calendar Integration

**SaaS-style:** Platform owns ONE Google OAuth app.

**Flow:**
1. User clicks "Connect with Google" in scheduling settings
2. Server redirects to `GET /api/scheduling/google/connect`
3. Google consent screen (scope: `calendar.events`)
4. Callback: `GET /api/scheduling/google/callback`
5. Tokens stored in `google_calendar_connections` (encrypted at rest)
6. Auto-refresh on expiry

**Routes:**
- `GET /api/scheduling/google/connect` — Redirect
- `GET /api/scheduling/google/callback` — OAuth callback (no auth, uses state param)
- `GET /api/scheduling/google/connections` — List connections
- `DELETE /api/scheduling/google/connections/:id` — Disconnect
- `GET /api/scheduling/google/calendar-links` — List available calendars
- `PATCH /api/scheduling/calendars/:id/google-connection` — Link calendar to connection

### 9.3 Slot Engine

**File:** `artifacts/api-server/src/services/scheduling/slot-engine.ts`

Computes available slots by:
1. Loading `availability_schedules` for the calendar
2. Applying `availability_overrides` (date-specific blocks)
3. Subtracting existing `bookings`
4. Respecting `buffer_before_mins` and `buffer_after_mins`
5. Respecting `max_bookings_per_slot`

**Concurrency:** `pg_try_advisory_xact_lock` in `lock.ts` prevents double-booking.

---

## 10. Campaign System

### 10.1 Campaign Lifecycle

1. **Create** — User creates campaign with agent, from_number, settings
2. **Add leads** — Upload CSV, import via webhook, or Meta integration
3. **Create batch** — Configure batch with schedule, timezone, business hours
4. **Launch** — Batch starts calling leads at scheduled time
5. **Monitor** — Real-time command center shows active calls
6. **Analyze** — Campaign analytics show funnel, dispositions, outcomes

### 10.2 Call Execution

- `campaign-ops.ts` manages the call queue
- Respects `concurrent_call_limit` (default 20)
- Respects `business_hours_start` and `business_hours_end`
- Respects `max_daily_calls`
- Retry logic: `max_attempts` (default 1), `retry_delay_minutes` (default 60)
- `scheduledCallbacks` table for retry scheduling

### 10.3 Lead Import

- **CSV:** Upload via dashboard, mapped to campaign fields
- **Webhook:** `POST /api/campaign/webhook/:token` — public endpoint
- **Meta:** Facebook Lead Ads integration
- **Duplicate detection:** `duplicatePolicy` ("ignore" | "skip" | "reject_with_report")

### 10.4 Outcomes

**Operational Outcome** (system-generated, immutable):
- `pending` — Not yet called
- `booking_created` — Successfully booked
- `transfer_completed` — Call transferred
- `callback_requested` — Caller requested callback
- `interest_confirmed` — Positive engagement
- `no_contact` — No answer / busy
- `dnc_blocked` — Do-not-call list
- `failed` — Technical failure

**Disposition** (user-defined categories from `dispositionsV2`):
- Free-form or predefined options
- LLM evaluates after each call based on `dispositionsV2` config

---

## 11. Billing & Payments

### 11.1 Wallet System

**User wallet:** `users.wallet_balance_cents`

**Transactions:**
- `wallet_transactions` table tracks all credits/debits
- `type`: "credit" (top-up), "debit" (call charge), "refund", "welcome_credit"
- `status`: "completed" | "pending" | "failed"
- `razorpay_order_id` and `razorpay_payment_id` for payment tracking

### 11.2 Top-up Flow

1. User clicks "Add Funds" in wallet page
2. Frontend creates Razorpay order via `POST /api/wallet/top-up`
3. Razorpay checkout opens
4. User completes payment
5. Razorpay webhook hits `POST /api/webhooks/razorpay`
6. Server verifies signature and credits wallet

### 11.3 Call Charging

**Usage tracking:** `record-usage.ts` logs every API call

**Cost computation:**
- **STT:** Per second (provider rate from `provider_pricing`)
- **LLM:** Per token (input + output rates from `provider_pricing`)
- **TTS:** Per character (provider rate from `provider_pricing`)
- **Telephony:** Per minute (provider rate from `provider_pricing`)

**Reseller markup:** `provider_minute_rates` allows per-minute markup on top of provider costs.

**Auto-pay:**
- `auto_pay_enabled` triggers automatic top-up when balance drops below `auto_pay_threshold_cents`
- Top-up amount: `auto_pay_amount_cents`

### 11.4 Free Credits

- New users get `$5` welcome credit (`freeCreditsGranted: true`)
- One-time only, tracked via `freeCreditsGranted` flag

---

## 12. Knowledge Base

### 12.1 Architecture

**PostgreSQL Full-Text Search only** — no embeddings/pgvector.

**Tables:**
- `knowledge_sources` — Document-level metadata (name, type, agent_id)
- `knowledge_entries` — Individual chunks (title, content, source_id)
- GIN index on `content` for FTS queries

**File:** `artifacts/api-server/src/orchestration/kb-retrieval.ts`

### 12.2 Retrieval Flow

1. User query arrives during call
2. `retrieveKbContext()` performs FTS on `knowledge_entries.content`
3. Returns up to 50 most relevant entries
4. Injected into LLM system prompt as context block

### 12.3 Adding Knowledge

- Dashboard: Upload documents (PDF, TXT, DOCX) or paste text
- Server splits into chunks, stores in `knowledge_entries`
- FTS index auto-updates

---

## 13. Deployment & Operations

### 13.1 Development

```bash
# Run API server
pnpm --filter @workspace/api-server run dev

# Run dashboard
pnpm --filter @workspace/dashboard run dev

# Run admin
pnpm --filter @workspace/admin run dev

# Run landing
pnpm --filter @workspace/landing run dev

# Full typecheck
pnpm run typecheck

# Build all
pnpm run build

# Generate API hooks from OpenAPI
pnpm --filter @workspace/api-spec run codegen

# Push DB schema changes (dev only)
pnpm --filter @workspace/db run push
```

### 13.2 Production Deployment

**Replit deployment** — automatic via artifact system.

**Artifacts registered:**
| Artifact | Path | Port | Type |
|----------|------|------|------|
| `api-server` | `/api` | 8080 | API |
| `dashboard` | `/` | 23183 | Web |
| `admin` | `/admin` | — | Web |
| `landing` | `/` | — | Web |

**Production secrets:** All env vars are secrets in Replit. After adding a new secret, **redeploy** the app for it to be picked up.

### 13.3 Health Monitoring

- `GET /api/healthz` — Health check
- `admin_alerts` table — System alerts
- `spike-alerts.ts` — Usage spike detection
- `activity-logs.ts` — User activity tracking

### 13.4 Logging

- **Server:** Never use `console.log`. Use `req.log` in routes, `logger` singleton elsewhere.
- **Production logs:** Access via `fetchDeploymentLogs()` tool
- **Key patterns:** Search for `ERROR`, `FATAL`, `WARN` in logs

### 13.5 Database Operations

**Backfill user identity:**
```bash
pnpm --filter @workspace/scripts run backfill-user-identity
```

**Wipe beta data (keep users/providers/wallets):**
```bash
DATABASE_URL=<url> pnpm --filter @workspace/scripts run wipe-beta-data
```

---

## 14. Debugging Guide

### 14.1 Call Not Working

**Checklist:**
1. Is the agent status "active"? (`agents.status`)
2. Does the agent have a valid provider key? (Dashboard → Providers)
3. Is the telephony number configured? (`agents.telephony_number`)
4. Is the user wallet balance > 0? (Dashboard → Wallet)
5. Check production logs for `ERROR` or `FATAL`
6. Check `calls.error_message` for the specific error

### 14.2 STT Not Working

**Checklist:**
1. Check `calls.stt_latency_ms` — is it null? (STT never connected)
2. Check provider key in `providers` table (decrypted)
3. Check `asrLanguage` → `agent.language` → provider default chain
4. Check if `asrFallbackProviders` is set and fallback is working
5. For streaming: check if provider WebSocket connection is established
6. For batch: check if API response is valid

### 14.3 LLM Not Working

**Checklist:**
1. Check `calls.llm_latency_ms` — is it null? (LLM never connected)
2. Check provider key in `providers` table or `platform_settings`
3. Check for 403 errors ("Lightning dunning decision" = Google Cloud project disabled)
4. Check if `managed_gemini_key` is set in Admin Panel
5. Check if agent has `llmProvider` configured
6. Check LLM adapter logs for specific error messages

### 14.4 TTS Not Working

**Checklist:**
1. Check `calls.tts_first_chunk_ms` — is it null? (TTS never connected)
2. Check provider key in `providers` table
3. Check if `ttsStream` is enabled (streaming vs batch)
4. Check TTS adapter logs for connection errors
5. Check if `ttsVoice` is valid for the provider

### 14.5 Scheduling Not Working

**Checklist:**
1. Is `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set in production? (Check with `viewEnvVars()`)
2. Is Google Calendar connected? (Dashboard → Scheduling → Google Connections)
3. Check `google_calendar_connections.needs_reconnect` — if true, reconnect
4. Check `availability_schedules` — are there any active schedules?
5. Check `availability_overrides` — is the date blocked?
6. Check `bookings` — is the slot already taken?

### 14.6 Campaign Not Working

**Checklist:**
1. Is campaign status "active" and `is_active` true?
2. Does the campaign have leads? (`campaign_leads` table)
3. Is the batch status "scheduled" or "running"?
4. Is `concurrent_call_limit` > 0?
5. Are business hours within current time?
6. Check `campaign_ops` for execution errors
7. Check production logs for campaign errors

### 14.7 Ambient Sounds Not Working

**Checklist:**
1. Is `ambientNoiseEnabled` true in agent config?
2. Is `ambientNoiseTrack` set to a valid track?
3. Check if audio endpoint is accessible: `GET /admin/ambient-sounds/:id/audio?token=...`
4. Check router mounting order — `ambientSoundsRouter` must be before `adminRouter`
5. Check if `normalizeLoopRms()` is working (verify RMS levels)

### 14.8 Auth Issues

**Checklist:**
1. Is `SESSION_SECRET` set in production?
2. Is `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set?
3. Check if `req.clerkUserId` is set in middleware
4. Check if `localStorage["voiceorch:session"]` has a valid token
5. Check if token is being sent as `Authorization: Bearer <jwt>`
6. Check `users` table — does the user exist? (provisioned on first login)

---

## 15. Common Issues & Quick Fixes

### 15.1 "Google OAuth not configured" (503)

**Cause:** `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` missing in production.

**Fix:**
1. Check if secrets are set: `viewEnvVars()`
2. If missing, add them in Replit Secrets panel
3. **Redeploy** the app — old deployments don't pick up new secrets

### 15.2 "Lightning dunning decision is deny" (403)

**Cause:** Google Cloud project disabled for Gemini API.

**Fix:**
1. Go to Google Cloud Console → Billing
2. Check for unpaid invoices or project suspension
3. Or add a new Gemini API key from a different project in Admin Panel → Managed Keys

### 15.3 "Provider key not found"

**Cause:** User hasn't added a provider key, or managed key is missing.

**Fix:**
1. Check `providers` table for user key
2. Check `platform_settings` for managed key (`managed_*_key`)
3. If BYOP, ask user to add key in Dashboard → Providers
4. If managed, add key in Admin Panel → Managed Keys

### 15.4 "Call ended immediately"

**Cause:** Wallet balance is 0 or negative, or provider key is invalid.

**Fix:**
1. Check `users.wallet_balance_cents`
2. Check `calls.error_message`
3. Check if provider key is valid (test with provider's API)

### 15.5 "Ambient sounds too quiet"

**Cause:** Per-track gains in `TRACK_PARAMS` produce inconsistent levels.

**Fix:**
- Already fixed in `ambient.ts` — `normalizeLoopRms()` normalizes all loops to `TARGET_LOOP_RMS`
- If still quiet, check `SILENCE_VOL` and `SPEECH_VOL` constants

### 15.6 "Barge-in too sensitive"

**Cause:** `BARGE_IN_ENERGY_THRESHOLD` too low or `bargeInMinFrames` too low.

**Fix:**
- Increase `bargeInEnergyThreshold` in agent config
- Increase `bargeInMinFrames` in agent config
- Enable `wordsForInterruption` (default 2) to require minimum words

### 15.7 "STT streaming fallback not working"

**Cause:** `asrFallbackProviders` not set or fallback provider key missing.

**Fix:**
1. Set `asrFallbackProviders` in agent config (e.g., `["deepgram", "sarvam"]`)
2. Ensure all fallback providers have valid keys
3. Check `stt/index.ts` for fallback logic

### 15.8 "Drizzle push loops forever"

**Cause:** Long foreign key names truncate at 63 chars.

**Fix:**
- Manually rename long FKs in schema
- Or use raw SQL for complex migrations
- See memory: `drizzle-push-gotchas.md`

### 15.9 "Type errors after OpenAPI change"

**Cause:** Codegen not run after `openapi.yaml` change.

**Fix:**
```bash
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck:libs
```

### 15.10 "Dashboard workflow failed"

**Cause:** Port collision or missing `BASE_PATH`.

**Fix:**
1. Check if `PORT` env var is set (workflow provides it)
2. Check Vite config — `server.allowedHosts: true` must be set
3. Restart the workflow: `restart_workflow("artifacts/dashboard")`

---

## Appendix A: File Reference

### Critical Files
| File | Purpose |
|------|---------|
| `lib/api-spec/openapi.yaml` | API contract source of truth |
| `lib/db/src/schema/*.ts` | All database tables |
| `artifacts/api-server/src/routes/index.ts` | Router mounting order |
| `artifacts/api-server/src/orchestration/pipeline.ts` | Telephony pipeline |
| `artifacts/api-server/src/orchestration/telephony/webcall.ts` | Browser pipeline |
| `artifacts/api-server/src/orchestration/adapters/stt/index.ts` | STT adapters |
| `artifacts/api-server/src/orchestration/adapters/llm/index.ts` | LLM adapters |
| `artifacts/api-server/src/orchestration/adapters/tts/index.ts` | TTS adapters |
| `artifacts/api-server/src/orchestration/ambient.ts` | Ambient sounds |
| `artifacts/api-server/src/lib/session.ts` | JWT session creation |
| `artifacts/api-server/src/lib/auth-compat.ts` | Auth shim |
| `artifacts/api-server/src/lib/crypto.ts` | Key encryption/decryption |
| `artifacts/api-server/src/services/tool-executor.ts` | Native tools |
| `artifacts/api-server/src/services/scheduling/slot-engine.ts` | Slot computation |
| `artifacts/api-server/src/services/scheduling/lock.ts` | Booking lock |
| `artifacts/api-server/src/services/scheduling/notifications.ts` | Email notifications |
| `artifacts/dashboard/src/App.tsx` | Dashboard routing |
| `artifacts/dashboard/src/lib/auth.tsx` | Auth context |
| `artifacts/api-server/src/routes/auth.ts` | Google OAuth routes |

### Environment Variables
| Var | Type | Required | Notes |
|-----|------|----------|-------|
| `DATABASE_URL` | Secret | Yes | Postgres connection |
| `SESSION_SECRET` | Secret | Yes | JWT signing |
| `GOOGLE_CLIENT_ID` | Secret | Yes | OAuth app |
| `GOOGLE_CLIENT_SECRET` | Secret | Yes | OAuth app |
| `GROQ_API_KEY` | Secret | Yes | Seeds `managed_qwen_key` |
| `ADMIN_TOKEN` | Secret | Yes | Admin auth |
| `RAZORPAY_KEY_ID` | Secret | Yes | Payments |
| `RAZORPAY_KEY_SECRET` | Secret | Yes | Payments |
| `UPSTASH_REDIS_REST_URL` | Secret | Yes | Session store |
| `UPSTASH_REDIS_REST_TOKEN` | Secret | Yes | Session store |
| `GMAIL_USER` | Secret | No | SMTP |
| `GMAIL_APP_PASSWORD` | Secret | No | SMTP |
| `GEMINI_API_KEY` | Secret | No | Gemini LLM |
| `SARVAM_API_KEY` | Secret | No | Sarvam STT |
| `CARTESIA_API_KEY` | Secret | No | Cartesia TTS |
| `VOBIZ_AUTH_ID` | Secret | No | Vobiz telephony |
| `VOBIZ_AUTH_TOKEN` | Secret | No | Vobiz telephony |
| `BREVO_API_KEY` | Secret | No | Brevo email |
| `PORT` | Runtime | Yes | Set by workflow |
| `BASE_PATH` | Runtime | Yes | Set by workflow |
| `NODE_ENV` | Runtime | Yes | "development" or "production" |

---

## Appendix B: Memory & Gotchas

### Durable Knowledge

1. **Router mounting order is critical** — `ambientSoundsRouter` must be before `adminRouter` because it has its own query-token auth.

2. **Webcall and pipeline are fully separate** — Any feature added to `pipeline.ts` must be duplicated in `webcall.ts`.

3. **STT fallback logic** — Streaming closes → reconnect with fallback; batch errors → iterate fallback chain.

4. **Barge-in word gate** — `wordsForInterruption` (default 2) prevents 1-word background utterances from cutting the agent.

5. **Google OAuth uses a single app** — Both login and calendar flows share `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` with different callback paths.

6. **Provider keys are encrypted at rest** — `AES-256-GCM`, key derived from `SESSION_SECRET`. Old plaintext keys pass through `decryptKey` transparently.

7. **Drizzle push gotchas** — Long FK names truncate at 63 chars → push loops. Raw SQL columns drift silently.

8. **Transient platform_settings keys** — Any transient key must call `registerTransientKey({ prefix, windowMs })` at startup for auto-cleanup.

9. **Gender service startup** — Lazy-import `librosa`; top-level import blocks uvicorn port binding.

10. **Replit production networking** — `localhost:80` (proxy) not available inside production container; `localhost:PORT` works for same-VM services.

---

*End of SnapServe Book v1.0*

**Questions?** Search this doc by section, or check the production logs with `fetchDeploymentLogs()`.