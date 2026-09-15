# SnapServe AI — Investor Overview
### Confidential · June 2026

---

## The One-Line Pitch

**SnapServe AI is the infrastructure layer that lets any business deploy production-grade AI voice agents in minutes — without touching a single telephony or LLM provider directly.**

---

## The Problem

Building an AI voice agent today means stitching together 4–6 vendor APIs yourself:

| Layer | Options |
|---|---|
| Speech-to-Text (ASR) | Deepgram, Azure, Whisper… |
| Language Model (LLM) | OpenAI, Anthropic, Mistral, Cohere… |
| Text-to-Speech (TTS) | ElevenLabs, Cartesia, Azure, AWS Polly… |
| Telephony | Twilio, Plivo, Vonage… |

Each combination requires bespoke WebSocket pipelines, latency tuning, fallback logic, streaming coordination, and production hardening. A single enterprise team spends **3–6 months** building this before the first call is made.

The result: only large companies with dedicated ML infra teams can deploy voice agents. Everyone else is locked out.

---

## The Solution

SnapServe is a **bring-your-own-key (BYOK) orchestration platform**. Customers plug in their existing provider API keys — keys they already pay for — and SnapServe handles everything in between:

```
Caller → Telephony (Twilio/Plivo/Vonage)
            ↓
       SnapServe Orchestration Layer
         ├── ASR (real-time streaming STT)
         ├── LLM (streaming, tool-call capable)
         ├── TTS (streaming, sentence-paced)
         ├── Conversation Memory
         ├── Knowledge Base (RAG)
         ├── Scheduling / Booking Engine
         └── Analytics & Observability
            ↓
        Agent Response → Caller
```

**Time to first live call: under 10 minutes.**

---

## Business Model

### Revenue: Pure Orchestration Margin

SnapServe charges for **orchestration only** — not for the underlying AI compute. Customers pay their LLM/ASR/TTS vendors directly and pay SnapServe for the real-time coordination layer.

| Plan | Rate | Target |
|---|---|---|
| **Developer** | $0.08 / minute | Solo builders, startups |
| **Production** | $0.12 / minute | SMBs, agencies |
| **Enterprise** | Custom | Large deployments, white-label |

New users get **$5 free credit** on signup — enough for ~40–60 minutes of live calls to validate use cases without a credit card.

### Why This Model Wins

- **No GPU costs** — SnapServe doesn't run models; it routes between them
- **Gross margins > 80%** — orchestration infra scales with CPU/network, not AI compute
- **Sticky** — agent configs, conversation history, scheduled bookings, and knowledge bases all live on the platform; switching cost is high
- **Aligned incentives** — customers who spend more on calls pay more; no flat seat fees that punish heavy users

---

## Product

### Core Platform

**Agent Builder** — Configure ASR + LLM + TTS + Telephony pipelines via a clean UI. No YAML, no infra. Supports 15+ provider combinations across all four layers.

**Live Calls** — Sub-500ms end-to-end latency via streaming pipelines. Barge-in detection, VAD tuning, filler phrases, dead-air handling, ambient noise overlay.

**Relationship Memory™** — Every call, every caller. The agent remembers prior interactions and picks up exactly where the last call ended. This is the moat: most competitors reset context on every call.

**Knowledge Base** — Full-text search over uploaded documents. The agent retrieves context mid-call to answer product, policy, or procedural questions accurately.

**Scheduling Engine** — Built-in multi-tenant booking system with Google Calendar sync, availability rules, date overrides, double-booking prevention (advisory locks), and automated email/webhook notifications. The agent books appointments *during the call*.

**Campaign Manager** — Outbound calling campaigns with lead lists, retry logic, callback detection, batch scheduling, and per-lead conversation tracking.

**Analytics** — Call volume, success rates, average duration, sentiment analysis (via Agnost AI integration), intent clustering, and frustration detection.

### Supported Providers (15+)

| Layer | Providers |
|---|---|
| ASR | Deepgram, Azure Speech, OpenAI Whisper, Sarvam |
| LLM | OpenAI, Anthropic, DeepSeek, Mistral, Cohere, Groq/Qwen, Google Gemini, Sarvam |
| TTS | ElevenLabs, OpenAI, Cartesia, AWS Polly, Azure, Deepgram |
| Telephony | Twilio, Plivo, Vonage, Vobiz |

---

## Market Opportunity

### TAM: The AI Voice Agent Market

- The global conversational AI market is projected to reach **$32B by 2030** (CAGR ~22%)
- Enterprise voice automation (IVR replacement, outbound sales, appointment booking) is the fastest-growing segment
- India alone has **60M+ SMBs** with no access to enterprise voice infrastructure — SnapServe's primary initial market

### Target Customers

| Segment | Use Case | ARPU Potential |
|---|---|---|
| Healthcare clinics | Appointment booking, prescription reminders | $500–2,000/mo |
| D2C e-commerce | Order tracking, returns, upsell calls | $1,000–5,000/mo |
| Financial services | Collections, KYC verification, loan follow-ups | $2,000–10,000/mo |
| Real estate | Lead qualification, site visit scheduling | $500–3,000/mo |
| Staffing / HR | Candidate screening, interview scheduling | $1,000–4,000/mo |
| Call center outsourcers | White-label AI voice layer | $10,000+/mo |

---

## Competitive Landscape

| | SnapServe | Bland AI | Vapi | Retell | Custom build |
|---|---|---|---|---|---|
| BYOK model | ✅ | ❌ | Partial | ❌ | ✅ |
| Relationship Memory | ✅ | ❌ | ❌ | ❌ | DIY |
| Built-in scheduling | ✅ | ❌ | ❌ | ❌ | DIY |
| Campaign manager | ✅ | Partial | ❌ | ❌ | DIY |
| Multilingual (Indian languages) | ✅ | ❌ | ❌ | ❌ | DIY |
| Time to deploy | 10 min | 30 min | 30 min | 30 min | 3–6 months |
| Gross margin | >80% | ~60% | ~60% | ~60% | N/A |

**Key differentiators:**

1. **BYOK = trust** — enterprise buyers don't want to hand their customer calls to a black-box AI vendor. SnapServe never touches the LLM keys; the customer keeps full control and cost visibility.

2. **Relationship Memory is defensible** — building persistent per-caller memory with multi-turn context across calls requires significant data modeling work. It's live and production-ready on day one.

3. **India-first multilingual stack** — native support for Sarvam (Hindi, Tamil, Telugu, Kannada, Marathi, Gujarati, Bengali, Malayalam) via streaming WebSocket puts SnapServe ahead of every Western competitor in the world's largest English-plus-vernacular market.

---

## Traction

- **Platform live in beta** — real users making real calls today
- **$5 free credit on signup** — self-serve funnel converting builders to paid users
- **15+ provider integrations** live across all four stack layers
- **Scheduling + booking** live and in active use by early customers
- **Campaign manager** live with outbound calling, retry logic, and lead management
- **Agnost AI analytics** integrated — real-time intent and sentiment tracking across all calls

---

## Technology

**Stack:** TypeScript / Node.js 24, React, PostgreSQL, Drizzle ORM, WebSockets

**Architecture highlights:**
- Real-time streaming pipeline (STT → LLM → TTS) over WebSockets, not HTTP polling
- Contract-first API design (OpenAPI → Zod validation + React Query codegen)
- Per-caller advisory lock on booking slots (zero double-bookings at scale)
- AES-256-GCM encryption of all provider API keys at rest
- Horizontal scale-ready: stateless orchestration workers, Redis for session state, Postgres for durable data

**Moat:** 18+ months of production hardening across every edge case in real-time audio pipelines — barge-in detection, echo suppression, filler phrase timing, gender detection, multi-language VAD tuning. This is not replicable quickly.

---

## Team

*[To be completed with founder bios, relevant experience, and advisors]*

---

## Use of Funds

| Category | Allocation |
|---|---|
| Engineering (2–3 hires) | 45% |
| Sales & Customer Success | 25% |
| Infrastructure & Security | 15% |
| Marketing & Brand | 10% |
| Legal & Compliance | 5% |

**Milestone targets (12 months post-raise):**
- 100 paying customers
- $50K MRR
- SOC 2 Type II compliance
- 3 enterprise contracts signed

---

## Ask

*[Funding amount, instrument (SAFE/priced round), valuation cap, and lead investor details to be discussed]*

---

## Contact

*[Founder name, email, LinkedIn, calendly link]*

---

*This document contains forward-looking statements and is intended for qualified investors only. All figures are projections unless otherwise stated.*
