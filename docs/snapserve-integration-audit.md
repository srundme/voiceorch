# SnapServe AI — Integration & Provider Audit

> **Scope:** All findings sourced directly from the codebase. No assumptions made.
> **Date:** July 2026

---

## Table of Contents

1. [Current AI Providers](#1-current-ai-providers)
   - [LLM Providers](#11-llm-providers)
   - [TTS Providers](#12-tts-providers)
   - [STT / ASR Providers](#13-stt--asr-providers)
   - [Telephony Providers](#14-telephony-providers)
2. [Current Integrations](#2-current-integrations)
3. [Future Integration Opportunities](#3-future-integration-opportunities)
4. [Priority Matrix](#4-priority-matrix)
5. [Integrations That Reduce the Sales Cycle](#5-integrations-that-reduce-the-sales-cycle)
6. [Integrations That Improve Customer Satisfaction](#6-integrations-that-improve-customer-satisfaction)
7. [Long-Term Integration Roadmap](#7-long-term-integration-roadmap)

---

## 1. Current AI Providers

### 1.1 LLM Providers

| Provider | Models Supported | Streaming | Fallback Support | Status | Notes |
|---|---|---|---|---|---|
| **OpenAI** | gpt-4o, gpt-4o-mini, gpt-4.1-nano, gpt-4.1-mini, gpt-4-turbo, gpt-3.5-turbo | ✅ | ✅ | Live | Primary managed-plan provider |
| **Google Gemini** | gemini-2.5-flash-lite, gemini-2.5-flash, gemini-3.5-flash, gemini-2.5-pro, gemini-3.1-flash-lite | ✅ | ✅ | Live | Context caching enabled (paid tier); 2.5 Flash-Lite is zero-thinking default |
| **Groq** | llama-3.3-70b-versatile, llama-3.1-8b-instant, qwen/qwen3-32b | ✅ | ✅ | Live | Used as managed fallback LLM; hosts Qwen |
| **Anthropic** | claude-3-5-sonnet, claude-3-5-haiku | ✅ | ✅ | Live | BYOP only |
| **Sarvam** | sarvam-30b, sarvam-105b | ✅ (buffered) | ✅ | Live | Indian language specialist; tool-call streaming buffered |
| **Krutrim** | gpt-oss-20b, gpt-oss-120b | ✅ | ✅ | Live | India-hosted; thinking in `delta.reasoning` |
| **DeepSeek** | deepseek-chat | ✅ | ✅ | Live | BYOP only |
| **Mistral** | mistral-large, mistral-small | ✅ | ✅ | Live | BYOP only |
| **Cohere** | command-r-plus, command-r | ✅ | ✅ | Live | BYOP only |
| **Together AI** | Various open-source models | ✅ | ✅ | Live | BYOP only |
| **OpenRouter** | qwen3.5, qwen3.6 + others | ✅ | ✅ | Live | BYOP only; no managed key |
| **Qwen** | qwen3-32b (via Groq) | ✅ | ✅ | Live | Routed through Groq |
| **Ultravox** | Multimodal voice models | ✅ | ❌ | Live | Multimodal / experimental path |

### 1.2 TTS Providers

| Provider | Models / Voices | Streaming | Languages | Status |
|---|---|---|---|---|
| **Cartesia** | sonic-3.5, sonic-turbo; admin-curated voice whitelist | ✅ | English + multilingual | Live — primary low-latency TTS |
| **ElevenLabs** | Rachel, Adam, and other neural voices | ✅ | 30+ languages | Live |
| **Sarvam (Bulbul)** | bulbul:v3 — 38 voices | ❌ (REST only) | Indian languages | Live |
| **Azure Speech** | Standard + neural voices | ✅ | 100+ languages | Live |
| **OpenAI TTS** | tts-1, tts-1-hd; alloy, echo, fable, onyx, nova, shimmer | ✅ | Multilingual | Live |
| **Deepgram Aura** | aura-asteria, aura-luna, aura-stella, aura-zeus | ✅ | English-focused | Live |
| **AWS Polly** | Standard + neural voices | ✅ | 30+ languages | Adapter present |

### 1.3 STT / ASR Providers

| Provider | Streaming | Languages | Status | Notes |
|---|---|---|---|---|
| **Deepgram** | ✅ | English + 30+ languages | Live — primary ASR | Default managed ASR |
| **Azure Speech** | ✅ | 100+ languages | Live | Continuous LID mid-call supported |
| **Sarvam (Saaras)** | ✅ | Indian languages | Live | saarika:v2.5 + saaras:v3; native 8 kHz telephony path |
| **AssemblyAI** | ✅ | English + multilingual | Live | Streaming + batch |
| **Cartesia** | Partial | English | Adapter present | Primarily TTS |
| **Whisper** | ❌ (batch only) | Multilingual | Listed in stack | Via OpenAI API |

### 1.4 Telephony Providers

| Provider | Inbound | Outbound | Recording | Transfer | AMD | Status |
|---|---|---|---|---|---|---|
| **Twilio** | ✅ | ✅ | ✅ | ✅ Warm + cold | ✅ Synchronous | Live — most feature-complete |
| **Plivo** | ✅ | ✅ | ✅ | ✅ | ✅ Synchronous | Live |
| **VoBiz** | ✅ | ✅ | ❌ | ✅ | ✅ Async callback | Live — India PSTN focus |
| **Vonage** | UI listed | UI listed | — | — | — | UI listed; adapter completeness unverified |
| **Webcall (Browser)** | N/A | N/A | ✅ (Postgres) | ❌ | ❌ | Live — WebRTC testing path |

---

## 2. Current Integrations

### Authentication & Identity

| Integration | Purpose | Status |
|---|---|---|
| **Google OAuth 2.0** | User login + Google Calendar account linking. Platform-owned OAuth app. Issues platform JWTs (HS256, 30-day TTL). | Live |

### Payments & Billing

| Integration | Purpose | Status |
|---|---|---|
| **Razorpay** | Wallet top-ups, recurring autopay mandates, phone number purchases | Live — active payment processor |
| **Stripe** | Referenced in docs; webhook signature pattern present | Not active — Razorpay is primary |

### Calendar & Scheduling

| Integration | Purpose | Status |
|---|---|---|
| **Google Calendar** | Check availability, create events, generate Google Meet links, sync bookings. Multi-account per user. Tokens encrypted at rest; auto-refreshed. | Live |

### Email & Notifications

| Integration | Purpose | Status |
|---|---|---|
| **Brevo (Sendinblue)** | Transactional emails — onboarding, scheduling confirmations | Live |
| **Gmail / nodemailer** | Scheduling email notifications (`GMAIL_USER` + `GMAIL_APP_PASSWORD`) | Live (optional) |
| **Slack (Incoming Webhooks)** | Admin alert notifications — usage spikes, critical system events | Live |

### CRM & Lead Sources

| Integration | Purpose | Status |
|---|---|---|
| **HubSpot** | Fetch contact lists for campaigns; write call outcomes + transcripts back | Live |
| **Zoho CRM** | CRM data integration | Live (adapter present) |
| **Meta (Facebook) Lead Ads** | Inbound webhook — ingest leads directly into campaigns; HMAC-SHA256 verified | Live |
| **Salesforce** | Referenced in UI and docs | Not implemented — UI placeholder only |

### Storage & Infrastructure

| Integration | Purpose | Status |
|---|---|---|
| **PostgreSQL bytea** | Call recording storage (stateless design) | Live |
| **Google Cloud Storage (GCS)** | Legacy ambient audio storage | Partial — new recordings use Postgres |
| **Redis** | Rate limiting, session management | Live |

### Webhooks

| Integration | Purpose | Status |
|---|---|---|
| **Inbound Webhooks** | Generic lead ingestion with HMAC-SHA256 signature verification | Live |
| **Outbound Tool Webhooks** | Agent tool execution fires webhooks to external services during a call | Live |

### AI / Supplementary Services

| Integration | Purpose | Status |
|---|---|---|
| **Gender Detection Service** | Python/FastAPI microservice — wav2vec2 + pitch-based gender classification for Sir/Ma'am salutation | Live (optional; `GENDER_SERVICE_URL`) |
| **pgvector** | Knowledge Base hybrid RAG — cosine vector search fused with PostgreSQL FTS via RRF | Live (falls back to FTS-only without extension) |

---

## 3. Future Integration Opportunities

### CRM
| Integration | Business Rationale |
|---|---|
| **Salesforce** | Enterprise standard; expected by F500 buyers; deal-stage sync from call outcomes |
| **Freshsales** | SMB CRM with built-in calling; relevant for Indian market |
| **Pipedrive** | Popular with sales teams; activity + deal-stage update from call |
| **HubSpot (deep sync)** | Extend current adapter to real-time deal-stage, sequence enrollment, and note creation |

### Marketing & Lead Sources
| Integration | Business Rationale |
|---|---|
| **Google Lead Forms** | Zero-friction lead import from Google Ads; no landing page needed |
| **LinkedIn Lead Gen Forms** | B2B leads directly into campaigns; high-quality signals |
| **TikTok Lead Ads** | Emerging channel; same webhook pattern as Meta (already implemented) |

### Communication
| Integration | Business Rationale |
|---|---|
| **WhatsApp Business API** | Post-call async follow-up; highest open rates of any channel in India |
| **Microsoft Teams** | Enterprise alert delivery and agent-handoff notifications |
| **Slack Bot** | Move beyond webhook-only; create tickets, post call summaries in channels |

### Scheduling
| Integration | Business Rationale |
|---|---|
| **Calendly** | Sync availability so agents book into existing Calendly links |
| **Cal.com** | Open-source alternative; API-compatible; self-hosted enterprise option |
| **Outlook Calendar** | Required for Microsoft-shop enterprises; pair with Microsoft OAuth |

### Helpdesk & Support
| Integration | Business Rationale |
|---|---|
| **Zendesk** | Auto-create tickets from calls; attach transcript; set priority from sentiment |
| **Freshdesk** | SMB helpdesk; same use case as Zendesk at lower price point |
| **Intercom** | Product-led growth; escalate bot conversation to live agent chat |

### Knowledge Base
| Integration | Business Rationale |
|---|---|
| **Notion** | Teams store SOPs in Notion; sync pages into KB automatically |
| **Google Drive** | Docs + Sheets as KB source; broad enterprise adoption |
| **Confluence** | Atlassian shops; enterprise KB standard |
| **SharePoint** | Microsoft enterprise document store |

### Commerce
| Integration | Business Rationale |
|---|---|
| **Shopify** | Post-call order lookup, order status via voice agent |
| **WooCommerce** | Same use case for WordPress-based stores |

### Payments
| Integration | Business Rationale |
|---|---|
| **Stripe** | International payment collection; required for global expansion beyond India |
| **PayU** | India alternative to Razorpay; broader bank coverage |

### Identity & SSO
| Integration | Business Rationale |
|---|---|
| **Okta** | Enterprise SSO; SAML/OIDC; required for large enterprise deals |
| **Auth0** | Developer-friendly SSO; MFA; roles/permissions |
| **Microsoft Azure AD** | Required for Microsoft-shop enterprise login |

### E-Signature
| Integration | Business Rationale |
|---|---|
| **DocuSign** | Send proposals for e-signature immediately after a successful call |
| **DigiSigner / SignNow** | Lower-cost alternatives; same sales-cycle acceleration |

### Operations
| Integration | Business Rationale |
|---|---|
| **Jira / Linear** | Auto-create bugs/tasks from escalated calls |
| **ClickUp / Asana** | Operational task creation from call outcomes |
| **Zapier / Make** | No-code bridge to unlock long-tail integrations without engineering |

---

## 4. Priority Matrix

Score: 1 (low) → 5 (high) per dimension. Total = sum of five dimensions (max 25).

| Integration | Customer Demand | Business Value | Enterprise Importance | Ease of Impl. | Competitive Advantage | Total | Tier |
|---|---|---|---|---|---|---|---|
| **WhatsApp Business API** | 5 | 5 | 4 | 3 | 5 | **22** | 🔴 Must Have |
| **Salesforce** | 5 | 5 | 5 | 2 | 5 | **22** | 🔴 Must Have |
| **Stripe** | 4 | 5 | 4 | 3 | 4 | **20** | 🔴 Must Have |
| **Google Lead Forms** | 4 | 5 | 3 | 4 | 4 | **20** | 🔴 Must Have |
| **Zendesk / Freshdesk** | 4 | 4 | 4 | 3 | 4 | **19** | 🔴 Must Have |
| **Outlook Calendar** | 3 | 4 | 5 | 3 | 3 | **18** | 🟠 High Priority |
| **LinkedIn Lead Gen** | 3 | 4 | 4 | 3 | 4 | **18** | 🟠 High Priority |
| **DocuSign / e-signature** | 3 | 4 | 4 | 3 | 4 | **18** | 🟠 High Priority |
| **HubSpot (deep sync)** | 4 | 4 | 3 | 4 | 3 | **18** | 🟠 High Priority |
| **Pipedrive** | 3 | 4 | 3 | 4 | 3 | **17** | 🟠 High Priority |
| **Freshsales** | 3 | 4 | 3 | 4 | 3 | **17** | 🟠 High Priority |
| **Calendly** | 4 | 4 | 3 | 3 | 3 | **17** | 🟠 High Priority |
| **Microsoft Teams** | 2 | 3 | 5 | 3 | 3 | **16** | 🟠 High Priority |
| **Okta / Azure AD SSO** | 2 | 3 | 5 | 2 | 4 | **16** | 🟠 High Priority |
| **Intercom** | 3 | 4 | 3 | 3 | 3 | **16** | 🟠 High Priority |
| **Notion / Google Drive KB sync** | 3 | 3 | 3 | 3 | 3 | **15** | 🟡 Medium Priority |
| **Jira / Linear** | 2 | 3 | 4 | 3 | 2 | **14** | 🟡 Medium Priority |
| **Shopify** | 2 | 3 | 2 | 3 | 3 | **13** | 🟡 Medium Priority |
| **Cal.com** | 2 | 3 | 2 | 4 | 2 | **13** | 🟡 Medium Priority |
| **PayU** | 2 | 2 | 2 | 4 | 2 | **12** | 🟡 Medium Priority |
| **Confluence / SharePoint** | 1 | 2 | 4 | 2 | 2 | **11** | 🟢 Nice to Have |
| **TikTok Lead Ads** | 2 | 2 | 1 | 4 | 2 | **11** | 🟢 Nice to Have |
| **Auth0** | 1 | 2 | 3 | 3 | 2 | **11** | 🟢 Nice to Have |
| **WooCommerce** | 2 | 2 | 1 | 3 | 2 | **10** | 🟢 Nice to Have |
| **Discord** | 1 | 1 | 1 | 4 | 1 | **8** | 🟢 Nice to Have |

---

## 5. Integrations That Reduce the Sales Cycle

### CRM Sync (Salesforce, HubSpot, Pipedrive)
When an agent calls a lead, it pulls the contact's full CRM history before the call begins — industry, past interactions, deal stage, and objections surfaced to the LLM as context. Post-call, outcomes write back automatically. Eliminates manual CRM data entry and makes every subsequent touchpoint smarter.
**Impact:** Shorter ramp-to-close; no lost context between calls.

### Zero-Touch Lead Import (Meta Lead Ads — live; Google Lead Forms, LinkedIn — recommended)
Leads flow directly from ad platforms into campaigns without a human hand-off. SnapServe begins the first outreach call within minutes of a form submission — when intent is highest.
**Impact:** Cuts lead response time from hours to minutes; materially improves contact rate.

### Native Scheduling (already live — Google Calendar + booking engine)
The agent books the next meeting during the call itself. The lead never has to "check their calendar and get back to you."
**Impact:** Eliminates the #1 drop-off point in outbound sales — the scheduling back-and-forth.

### In-Call Payment Collection (Razorpay — live; Stripe — recommended)
For transactional products, the agent shares a payment link or initiates a mandate during the call and confirms payment before hanging up.
**Impact:** Removes the "I'll pay later" objection; highest conversion happens at peak intent.

### WhatsApp Follow-Up (recommended)
After a call, an automated WhatsApp message sends the summary, meeting link, proposal, or payment link. WhatsApp open rates in India exceed 90%.
**Impact:** Keeps the deal warm; recovers leads who didn't convert on the first call.

### E-Signature (DocuSign / DigiSigner — recommended)
Immediately after a successful call, an e-signature request is sent. The contract is signed within hours, not days.
**Impact:** Removes the "send me the paperwork" delay; shortens the cycle by days in high-touch B2B.

---

## 6. Integrations That Improve Customer Satisfaction

### CRM History In-Call (Salesforce, HubSpot, Zoho — partial live)
The agent knows who the caller is before they speak. Name, account tier, last interaction, open tickets — all surfaced to the LLM. The caller never has to repeat themselves.
**Business Impact:** Removes the single most common complaint in customer service — re-explaining your situation.

### Helpdesk / Ticketing (Zendesk, Freshdesk — recommended)
When a call escalates or ends unresolved, a ticket is auto-created with the full transcript, sentiment score, and call recording attached. The support agent picks up exactly where the voice agent left off.
**Business Impact:** Zero re-explain loop; faster resolution; measurable SLA compliance.

### Knowledge Base (live — hybrid RAG; Notion/Google Drive sync recommended)
The agent retrieves grounded answers from the company's own documentation. KB sync with Notion or Google Drive keeps the KB current without manual uploads.
**Business Impact:** Higher answer accuracy; fewer escalations; lower AHT.

### Order Tracking API Hooks (Shopify, WooCommerce — recommended)
For e-commerce, the agent looks up order status in real time. No "let me transfer you to the order team."
**Business Impact:** Deflects the most common inbound call type; available 24/7.

### WhatsApp Delivery Updates (recommended)
Post-call confirmation, booking reminder, or issue resolution via WhatsApp. Caller feels informed and in control.
**Business Impact:** Reduces repeat inbound calls; improves NPS.

### CSAT / NPS Post-Call Survey (recommended)
Immediately after a call, a WhatsApp or SMS survey fires. 2–3 questions, 30 seconds. Response feeds back into platform analytics.
**Business Impact:** Continuous quality signal; identifies agent/script failures before they compound.

### Live Agent Handoff (already live — warm transfer with whisper briefing)
When the AI cannot resolve an issue, it transfers to a human and whispers the call summary before the agent takes over. The customer never experiences a cold handoff.
**Business Impact:** Maintains trust; prevents escalation → abandonment.

---

## 7. Long-Term Integration Roadmap

| Horizon | Definition |
|---|---|
| **Now (0–3 months)** | Fill gaps that block enterprise sales or are partially implemented |
| **6 months** | High-priority integrations that expand the addressable market |
| **12 months** | Vertical-specific and ecosystem-completing integrations |
| **18 months+** | Platform maturity; marketplace / partner ecosystem |

### Sales
| Integration | Horizon |
|---|---|
| Salesforce full sync | Now |
| HubSpot deep sync (deal stage, sequences, notes) | Now |
| Stripe (international) | Now |
| Google Lead Forms | Now |
| DocuSign / e-signature | 6 months |
| Pipedrive | 6 months |
| Freshsales | 6 months |
| LinkedIn Lead Gen | 6 months |
| TikTok Lead Ads | 12 months |

### Marketing
| Integration | Horizon |
|---|---|
| WhatsApp Business API | Now |
| WhatsApp template campaigns | 6 months |
| Klaviyo / Mailchimp email sequences | 12 months |
| Marketing attribution webhooks | 12 months |

### Customer Support
| Integration | Horizon |
|---|---|
| Zendesk | Now |
| Freshdesk | 6 months |
| Intercom | 6 months |
| CSAT / NPS post-call (in-house SMS/WhatsApp) | 6 months |
| Jira / Linear (bug escalation) | 12 months |

### Operations
| Integration | Horizon |
|---|---|
| Zapier / Make (no-code bridge) | 6 months |
| Slack Bot (not just webhook) | 6 months |
| Microsoft Teams | 12 months |
| ClickUp / Asana | 12 months |

### Identity & Enterprise SSO
| Integration | Horizon |
|---|---|
| Okta / Azure AD SSO | 6 months |
| Auth0 | 12 months |
| Confluence / SharePoint KB | 12 months |

### HR
| Integration | Horizon |
|---|---|
| Darwinbox / Zoho People | 18 months+ |
| Greenhouse / Lever (recruiting) | 18 months+ |

### Healthcare
| Integration | Horizon |
|---|---|
| Practo / HealthPlix (India EMR/EHR) | 12 months |
| ABDM (India national health stack) | 18 months+ |
| Google Health / FHIR API | 18 months+ |

### Finance
| Integration | Horizon |
|---|---|
| Razorpay extended (recurring, split pay) | Now |
| Stripe (global) | Now |
| Setu / India UPI / Account Aggregator | 12 months |
| NBFC loan origination APIs | 18 months+ |

### Real Estate
| Integration | Horizon |
|---|---|
| DocuSign (lease / agreement) | 6 months |
| MagicBricks / 99acres APIs | 12 months |
| PropTiger CRM | 12 months |

### Education
| Integration | Horizon |
|---|---|
| LeadSquared (EdTech CRM) | 6 months |
| LMS webhooks (Moodle, Canvas) | 12 months |
| NEET / JEE coaching CRMs | 12 months |

---

## Summary: Top 5 Integrations for Competitive Advantage

| Rank | Integration | Why It Wins |
|---|---|---|
| 1 | **WhatsApp Business API** | Highest-reach async follow-up channel; no competitor has closed this loop natively with voice AI |
| 2 | **Salesforce** | Single integration that unlocks F500 deals; currently a hard blocker |
| 3 | **Zendesk / Freshdesk** | Turns SnapServe from a dialer into a full support automation platform |
| 4 | **Google Lead Forms + LinkedIn Lead Gen** | Closes the lead-to-call loop without human intervention — true zero-touch pipeline |
| 5 | **DocuSign / E-signature** | Turns a completed call into a signed contract in the same session — no other voice AI platform does this end-to-end |
