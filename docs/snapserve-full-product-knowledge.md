# SnapServe — Complete Product Knowledge (Agent KB)

**Product:** SnapServe AI — Indic-first AI voice agent platform  
**App:** https://app.snapserve.ai  
**API base:** https://app.snapserve.ai/api  
**Audience for this doc:** Voice agents, sales assistants, POC demos, internal briefings  
**Last updated:** 2026-08-06

Use this document as the **source of truth** for what SnapServe is, how it works, features, hosting, and compliance. Prefer facts here over guessing. If something is not listed, say you will confirm with the SnapServe team rather than inventing details.

---

## 1. What SnapServe is

SnapServe lets businesses create **AI voice agents** that talk to people on:

- **Phone calls** (inbound / outbound India PSTN and global carriers)
- **Browser webcalls** (test links, website widgets)
- **Google Meet / Zoom / Microsoft Teams** (meeting bots)
- Follow-ups on **WhatsApp** and **Email**

The agent understands speech, thinks with an LLM, speaks back naturally, can use tools (book meetings, send WhatsApp, look up knowledge, update CRM), and logs every call for review.

**Positioning:** Built for India first — multilingual (Tamil, Hindi, Telugu, Kannada, Malayalam, Hinglish, English), logistics/SME/hiring/clinic/collections style phone work, TRAI/DPDP-aware outbound patterns, Razorpay wallet billing.

---

## 2. How a voice call works (simple)

```
Caller speaks
    → STT (Speech-to-Text) turns voice into text
    → LLM decides what to say / which tool to call
    → TTS (Text-to-Speech) speaks the reply
    → Telephony / Webcall / Meeting bridge plays audio
```

| Layer | Role | Common providers on SnapServe |
|-------|------|-------------------------------|
| **STT** | Hear the user | Sarvam (Indic), Deepgram, Azure, Google, etc. |
| **LLM** | Reason + tools | Google Gemini, Groq, Sarvam LLM, OpenAI-compatible, Krutrim (India-hosted option), etc. |
| **TTS** | Speak | Cartesia, Sarvam Bulbul, ElevenLabs, Azure, AWS Polly, etc. |
| **Telephony** | Phone network | **Vobiz** (India-focused), Twilio, Plivo |
| **Meetings** | Join Meet/Zoom/Teams | Recall.ai bot + SnapServe voice page |

**Modes:**

- **Managed:** SnapServe can supply platform keys for selected providers.
- **BYOP (Bring Your Own Provider):** Customer pastes their own API keys; keys are stored encrypted.

---

## 3. Core product areas (feature map)

### 3.1 Agents
- Create named agents with system prompt, language, voice, tools.
- **Phone-only** or **Phone + meetings** agents.
- Engine settings: silence timeouts, barge-in, ambient noise, latency tradeoffs.
- Tools: end call, transfer, DTMF/IVR, scheduling, WhatsApp/email send, custom HTTP tools, meeting chat / presentation / rejoin (in meetings).
- Knowledge bases (RAG) attach to ground answers on company docs.
- Caller memory: remember facts about a phone number / email across calls.
- Dispositions: post-call labels (interested, callback, not interested…).
- Squads: multi-agent handoffs for complex flows.
- Webcall links: share a browser link to test without a phone.

### 3.2 Phone numbers
- Buy / assign DIDs from dashboard (India flows often via Vobiz; KYC may apply for own sub-accounts).
- One number can power inbound agent + outbound campaigns.

### 3.3 Campaigns (outbound at scale)
Sources to start calling:

| Source | Use |
|--------|-----|
| **CSV** | Upload leads, batch dial |
| **Google Sheets** | Automatic Calls from sheet rows |
| **Website form webhook** | Form submit → lead → dial |
| **Meta Lead Ads** | Facebook/Instagram leads |
| **Zoho CRM** | CRM-driven campaigns |

Campaign controls: activate / pause / resume / stop, concurrency limits, business hours, redial, batch wizards. Track outcomes in **History / call logs**.

### 3.4 Journeys
Lead intake sequences (e.g. event outreach): form → call → WhatsApp/email follow-up with presets.

### 3.5 Scheduling / bookings
- Google Calendar connect.
- Book slots during the call; send Meet link.
- Meeting bot can auto-join booked Meet links near slot time.
- Emails to attendees (Brevo / configured mail).

### 3.6 Meetings (Google Meet / Zoom / Teams)
- Paste a link (Meet page) or auto-dispatch from a booking.
- Bot joins as SnapServe meeting agent (signed-in Google identity when configured).
- Live voice AI in the room (same SnapServe brain as phone).
- Speaker identification via Recall participant events; SnapServe STT still owns words.
- Meeting chat messages, presentation screenshare (Slides/PDF/URL), schedule rejoin same link.
- After call: mixed meeting video, per-speaker audio, diarized transcript appendix on the call log.
- Host may need to **admit** the bot from waiting room (platforms don’t allow silent auto-admit of all guests).

### 3.7 WhatsApp & Email
- WhatsApp: Meta Business API (own number) or BYO BSP.
- Email: Brevo for mid-call / post-call messages (meeting links, summaries, payment links).
- High open rates in India for WhatsApp follow-ups.

### 3.8 Integrations & webhooks
- Post-call webhook JSON to Zapier / CRM / custom HTTPS endpoints.
- Website lead webhook: `POST /api/webhooks/lead/{token}` with `{ "phone", "name", ... }`.
- API keys (`sk_live_...`) for programmatic control; MCP tools for agent builders.
- Knowledge upload + attach to agents.

### 3.9 Wallet, billing, analytics
- Prepaid **wallet** (Razorpay top-up in India).
- Usage billed for minutes / provider costs depending on plan and managed vs BYOP.
- Analytics dashboard: call volume, outcomes, agent performance.
- Autopay options where configured.

### 3.10 Admin / team
- Multi-tenant accounts, team tags, teammate prompt switching.
- Admin panel for platform ops (operator-side).
- Activity logs, spike alerts, health check `GET /api/healthz`.

---

## 4. Typical customer workflows

1. **Create agent** → set prompt + voice + Indic STT/TTS → attach knowledge → test via webcall.
2. **Assign phone** → inbound IVR or direct agent.
3. **Campaign:** CSV / Sheets / website webhook → activate → dial → dispositions → History.
4. **Book meetings** from call → calendar + Meet link → meeting bot joins for POC demos.
5. **Post-call:** WhatsApp summary + CRM webhook.
6. **Squad:** specialist agents for collections vs support vs sales handoff.

---

## 5. Hosting & technical posture (what you can say)

| Topic | Fact to use |
|-------|-------------|
| **Product URL** | https://app.snapserve.ai |
| **Architecture** | Multi-tenant SaaS: React dashboard + Express API + Postgres + Redis + object storage + real-time voice orchestration |
| **Auth** | Google sign-in for dashboard users; API keys for machine access; session secrets for signed tokens |
| **Data store** | PostgreSQL (Drizzle ORM); Redis for sessions / realtime concerns |
| **Secrets** | Provider API keys encrypted at rest (derived from platform secret) |
| **Payments** | Razorpay for wallet / number purchase flows in India |
| **Voice stack** | Pluggable STT/LLM/TTS; India-friendly defaults often Sarvam + Gemini/Cartesia + Vobiz |
| **Meetings** | Recall.ai for bot join + recording artifacts; SnapServe owns conversational AI |
| **Deployment** | Cloud-hosted production app at app.snapserve.ai (containerized artifact deploy; ops via platform secrets) |
| **Observability** | Call records, transcripts, latency fields, structured server logs, admin alerts |

**Do not invent:** SOC 2 / ISO certificate numbers, exact data-center city, or SLA % unless the SnapServe team has given a written claim for that customer. If asked, say: *SnapServe is a cloud SaaS; encryption at rest for keys, Google auth, India compliance toggles (DPDP/TRAI/IRDAI); for enterprise DPA / residency paperwork we involve the SnapServe team.*

---

## 6. Compliance SnapServe supports

SnapServe exposes **agent-level compliance toggles** and runtime gates:

### 6.1 DPDP (India Digital Personal Data Protection)
- When enabled: prompt disclosures about personal data use; post-call checks that can flag PII in transcripts.
- Message to customers: designed to support **India DPDP-aware** voice operations (consent/purpose style disclosures + safer handling of personal data in call logs).

### 6.2 TRAI (telecom / telemarketing norms)
- When enabled: **calling-hours** and **suppression-list** style pre-dial gates so outbound is blocked when outside allowed windows / suppressed numbers.
- Relevant for India outbound campaigns and B2C dialing.

### 6.3 IRDAI (insurance)
- When enabled: prompt must meet structured IRDAI disclosure requirements or **outbound is blocked** until fixed.
- For insurance use cases only; not required for logistics POC unless they sell insurance products.

### 6.4 Operational security hygiene
- Encrypted provider keys, authenticated APIs, tenant isolation by user/account, webhook HTTPS, meeting bot ownership checks, wallet-gated usage.
- Call recordings / meeting recordings are opt-in / feature-configured; meeting chat can notify participants that recording may occur.

**Honest framing for HR / enterprise buyers:** SnapServe provides **product controls** aligned to DPDP / TRAI / IRDAI patterns. Legal sign-off, DPA, and customer-side consent scripts remain a joint exercise with the customer’s compliance team.

---

## 7. Why voice agents help a logistics company (ProConnect-style)

ProConnect-type businesses (3PL, warehousing, transportation, reverse logistics, mission-critical spare parts, ecommerce fulfilment, PAN-India ops) live on phone + WhatsApp. High-fit SnapServe use cases:

| Use case | What the agent does | Business value |
|----------|---------------------|----------------|
| **Customer / dealer helpline** | Answer “where is my shipment?”, capture ticket, escalate | Lower wait time, 24×7 first response |
| **Driver / fleet check-ins** | Outbound calls for ETA, delay reason, POD reminder | Real-time ops visibility without manual dialing |
| **Warehouse shift / attendance** | Confirm reporting, language-local (Tamil/Hindi) | Less supervisor phone load |
| **Reverse logistics / RMA** | Qualify pickup, schedule slot, send WhatsApp link | Faster returns cycle |
| **Mission-critical parts desk** | Triage urgency (4-hr / next-flight), create case, conference human | Protect SLAs |
| **Lead / RFQ intake** | Website or Meta lead → call in 60s → book sales meeting | Higher connect rate |
| **Collections / COD confirmation** | Confirm delivery window & payment | Fewer failed attempts |
| **Vendor / transporter coordination** | Multi-language outbound in regional languages | Chennai + pan-India coverage |
| **HR screening (internal)** | First-round interview / document checklist calls | HR bandwidth for ProConnect itself |
| **Meeting POC demos** | Meeting bot joins Meet to demo SnapServe live | Exactly this sales motion |

**POC-friendly starter pack for logistics:**

1. One **Tamil/English Tanglish** inbound/outbound agent for shipment status + ticket create (KB + CRM webhook).  
2. One **Sheets or CSV campaign** for driver ETA check-ins.  
3. **WhatsApp** post-call summary with ticket ID.  
4. Optional **Meet bot** for weekly ops review with a human specialist.

Success metrics to propose: connect rate, average handle time, % tickets auto-created, % callbacks booked, CSAT after 2 weeks.

---

## 8. Pricing posture (how to talk without inventing numbers)

- Usage is **wallet-based** (top up via Razorpay).
- Cost drivers: telephony minutes, STT/LLM/TTS (managed vs BYOP), meeting-bot minutes, WhatsApp/email sends.
- For POC: SnapServe usually scopes a **limited minutes / limited agents / fixed duration** pilot — exact commercials come from the SnapServe commercial owner on the call (you facilitate; you don’t invent INR rates).

---

## 9. Competitive / category context (short)

SnapServe sits in the **AI voice agent / conversational telephony** category (vs chatbots). Differentiators to emphasize for India logistics:

- Indic languages + colloquial Tanglish
- Campaigns + Sheets + website webhook in one product
- Meetings + phone + WhatsApp in one agent story
- Compliance toggles (DPDP/TRAI/IRDAI)
- India telephony via Vobiz-friendly paths

---

## 10. Glossary

| Term | Meaning |
|------|---------|
| **Agent** | Configured AI persona (prompt, voice, tools) |
| **Campaign** | Outbound calling program over a lead list |
| **Disposition** | Outcome label after a call |
| **Journey** | Multi-step lead sequence (call + WA + email) |
| **KB / Knowledge** | Documents the agent can retrieve answers from |
| **Webcall** | Browser-based voice session |
| **Meeting bot** | Agent that joins Meet/Zoom/Teams |
| **BYOP** | Customer’s own STT/LLM/TTS keys |
| **Wallet** | Prepaid balance for usage |

---

## 11. Things the assistant must not invent

- Exact INR pricing, SLA %, uptime certificates not listed here  
- Claiming SnapServe “auto-admits” all Meet guests (hosts may need to admit)  
- Claiming SnapServe replaces WMS/TMS — it **augments** phone/WhatsApp workflows around logistics systems  
- Fake customer logos or made-up ProConnect internal metrics  

When unsure: *“I can check with our SnapServe team and send that after the call.”*
