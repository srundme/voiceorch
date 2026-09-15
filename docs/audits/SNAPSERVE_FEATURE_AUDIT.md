# SnapServe — Feature Audit & GTM Review

> Review each section. Mark features to **KEEP**, **FIX**, or **CUT** before the open-source push and hackathon.

---

## How SnapServe Works (Core Flow)

```
User creates an Agent (STT + LLM + TTS + Telephony config)
    ↓
Inbound call arrives / Outbound campaign fires
    ↓
SnapServe WebSocket handles real-time audio stream
    ↓
STT: speech → text  (Deepgram / Sarvam / Azure / Whisper)
    ↓
LLM: text → response  (OpenAI / Groq / DeepSeek / Anthropic / Sarvam)
    ↓
TTS: response → audio  (ElevenLabs / Cartesia / Sarvam / AWS Polly)
    ↓
Memory: caller profile updated, facts extracted, archive saved
    ↓
Call ends → transcript saved, agent stats updated
```

---

## ARTIFACT 1 — Dashboard (Main User Product)

### ✅ KEEP — Core GTM Features

| Feature | What it does | Status |
|---|---|---|
| **Agent Builder** | Create/edit voice agents with STT+LLM+TTS+Telephony config | Works |
| **Call Logs** | Full call history, transcripts, status, duration | Works |
| **Caller Memory** | Per-caller profiles, facts, call history — the key differentiator | Works |
| **Providers** | User brings own API keys (Deepgram, OpenAI, ElevenLabs, Twilio etc.) | Works |
| **Analytics** | Call volume chart, success rate, avg duration | Works |
| **Wallet** | Credit balance, usage tracking | Works |
| **Onboarding** | New user setup flow | Works |

### ⚠️ KEEP BUT FIX — Needs Polish Before GTM

| Feature | Issue | Fix needed |
|---|---|---|
| **Outbound Campaigns** | Core feature but complex UI — confusing for new users | Simplify the create flow |
| **Phone Numbers** | Buying/managing numbers works but no India-specific providers | Add Exotel / Tata Comm |
| **Webhooks** | Works but no docs, no test button in UI | Add test webhook button |
| **Test Simulator** | Exists but buggy — doesn't reflect real call behavior accurately | Fix or remove |
| **Knowledge Base** | Uploads work, FTS works, but no clear UI showing it's active on an agent | Show KB status on agent card |
| **Scheduling** | Fully built but completely disconnected from voice agents | Wire to agents or cut |
| **Settings page** | Placeholder — shows nothing useful | Populate or remove |

### ❌ CUT — Not Needed for MVP GTM

| Feature | Why cut |
|---|---|
| **Assistants page** | Duplicate of agents with different framing — confuses users |
| **Meta Leads** | Facebook leads integration — niche, unfinished |
| **KYC page** | Incomplete, no real flow — looks broken |
| **Transfers page** | Call transfer UI — edge case, not core MVP |
| **Command Center** | Live queue monitoring — enterprise feature, overkill for MVP |
| **Activity Logs** | Too technical for most users at this stage |
| **Agent Variables** | Advanced templating — useful later, not day 1 |
| **Agent Templates** | Good idea but template library is empty |
| **Usage page** | Redundant with wallet page |
| **Privacy / Terms pages** | Placeholder text, not real legal docs — remove or replace |
| **Landing page (in dashboard)** | Conflicts with the actual product — remove |

---

## ARTIFACT 2 — Admin Panel

### ✅ KEEP

| Feature | What it does |
|---|---|
| **Users** | View all users, usage, wallet balances |
| **Platform Overview** | Total calls, revenue, active agents |
| **Managed Keys** | Platform-level API keys (Groq fallback etc.) |
| **Call Pricing** | Set per-minute rates |
| **Health Monitor** | Service status |
| **Prompt Templates** | Reusable system prompts for agents |

### ❌ CUT from open-source (keep in closed platform)

| Feature | Why |
|---|---|
| **Finance dashboard** | Revenue tracking — internal only |
| **Growth metrics** | Internal analytics |
| **Ambient Sounds** | Background noise for calls — niche, incomplete |
| **Admin Voices** | Internal voice library management |
| **Managed Numbers** | Internal number pool management |

---

## ARTIFACT 3 — Family App & Family Mobile

### ❌ CUT ENTIRELY

These are a completely separate product — an **Insurance Agent Portal** for a specific customer (not a platform feature).

- `family-app` — web portal for insurance field agents
- `family-mobile` — Expo mobile app for insurance agents

**Action:** Remove from the open-source repo entirely. Keep in a separate private repo if still needed.

---

## ARTIFACT 4 — Gender Service

### ❌ CUT from open-source

A Python ML microservice that detects caller gender from voice.

- Technically works but adds infrastructure complexity (Python + librosa)
- Not a core feature users understand or need on day 1
- Can be added back later as a plugin

---

## SUPPORTED PROVIDERS — Status

### STT (Speech to Text)
| Provider | Status | Notes |
|---|---|---|
| Deepgram | ✅ Works | Best for English |
| Sarvam | ✅ Works | Best for Hindi/Indian languages |
| Azure | ✅ Works | Good multilingual |
| Whisper | ✅ Works | Offline/self-hosted |

### LLM
| Provider | Status | Notes |
|---|---|---|
| OpenAI | ✅ Works | |
| Groq | ✅ Works | Fastest for inference |
| DeepSeek | ✅ Works | Cheap |
| Anthropic | ✅ Works | |
| Sarvam | ✅ Works | Indian languages |
| Mistral | ✅ Works | |
| Cohere | ✅ Works | |

### TTS (Text to Speech)
| Provider | Status | Notes |
|---|---|---|
| ElevenLabs | ✅ Works | Best voice quality |
| Cartesia | ✅ Works | Low latency |
| Sarvam | ✅ Works | Indian languages |
| AWS Polly | ✅ Works | |
| Azure | ✅ Works | |
| Deepgram Aura | ✅ Works | |
| OpenAI TTS | ✅ Works | |

### Telephony
| Provider | Status | Notes |
|---|---|---|
| Twilio | ✅ Works | Global |
| Plivo | ✅ Works | India-friendly |
| Vobiz | ✅ Works | Indian provider |
| WebCall | ✅ Works | Browser-based calls |

---

## WHAT'S MISSING FOR GTM

These don't exist yet and are blockers or near-blockers:

| Gap | Priority | Notes |
|---|---|---|
| **Proper docs / getting started guide** | 🔴 Critical | No user can self-onboard without docs |
| **India telephony (Exotel / Tata Comm)** | 🔴 Critical | Twilio expensive in India, Plivo setup hard |
| **One-click demo agent** | 🔴 Critical | User should hear a working agent in <2 min |
| **Pricing page** | 🟡 High | No clear pricing shown anywhere |
| **Error messages** | 🟡 High | Many errors are raw API errors, not user-friendly |
| **OpenAI Realtime support** | 🟡 High | Needed for low-latency English agents |
| **Usage limits / rate limiting** | 🟡 High | No guardrails on runaway spend |
| **Agent status page (uptime)** | 🟠 Medium | Users need to know if their agent is live |
| **Call recording download** | 🟠 Medium | Users want to download transcripts/audio |
| **GDPR / data deletion** | 🟠 Medium | Required for B2B customers in EU |
| **Multi-language docs** | 🟠 Medium | Hindi docs for Indian market |

---

## RECOMMENDED MVP SCOPE (what to ship first)

Keep only what a new user needs to go from zero to first working call:

```
✅ Agent Builder (simplified — 3 steps max)
✅ Call Logs + Transcripts
✅ Caller Memory (the differentiator)
✅ Providers (bring your own keys)
✅ Basic Analytics
✅ Wallet
✅ Outbound Campaigns (simplified)
✅ Webhooks

Everything else → hide behind a feature flag or remove
```

---

## OPEN-SOURCE vs CLOSED PLATFORM SPLIT

| Layer | Open Source | Closed Platform |
|---|---|---|
| Orchestration engine (STT→LLM→TTS) | ✅ | ✅ |
| Telephony adapters | ✅ | ✅ |
| Caller memory engine | ✅ | ✅ |
| Provider adapters | ✅ | ✅ |
| REST API (core) | ✅ | ✅ |
| Dashboard UI | ❌ | ✅ |
| Admin panel | ❌ | ✅ |
| Campaign engine | ❌ | ✅ |
| Billing / wallet | ❌ | ✅ |
| Scheduling | ❌ | ✅ |
| Analytics | ❌ | ✅ |

---

*Last reviewed: June 2026*
