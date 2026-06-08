# SnapServe AI — Complete Product Reference

> Use this file as the source of truth when writing landing page copy, designing sections, or drafting any marketing content.

---

## Brand

- **Product name:** SnapServe AI
- **Tagline options:**
  - "Voice Agent Orchestration"
  - "Ship voice agents in minutes, not months"
  - "Your providers. Our orchestration."
  - "AI voice calls — built, deployed, done."
- **Domain / API base:** `api.snapserve.ai`
- **Contact:** `sales@snapserve.ai`
- **Year:** 2026
- **Status:** Beta — Now live

---

## Elevator pitch

SnapServe AI is an AI Voice Agent Orchestration SaaS. You bring your own API keys from providers you already trust (Deepgram, OpenAI, ElevenLabs, Twilio, etc.). SnapServe wires them together into a real-time call pipeline with persistent caller memory, barge-in detection, outbound campaigns, smart scheduling, and live monitoring — so you ship a production-grade voice agent in an afternoon, not months.

---

## Core value props

| Prop | One-liner |
|---|---|
| Bring Your Own Keys | Your provider keys, your costs. We only charge for orchestration. |
| Persistent Caller Memory | Agents remember every caller across sessions — no repeated intros. |
| Real-Time Orchestration | Sub-100 ms pipeline. ASR → LLM → TTS without dropped audio. |
| Outbound Campaigns | Schedule bulk calls, track dispositions, deliver to your CRM via webhook. |
| Built-in Scheduling | Availability windows, timezone awareness, Google Calendar sync included. |
| Live Monitoring | Watch any active call in real time from the dashboard. |

---

## Features (full list)

### Voice Agent Builder
- Create agents with a full pipeline config: ASR provider + model, LLM provider + model, TTS provider + model + voice, telephony provider
- System prompt editor with temperature, max tokens, presence/frequency penalty controls
- Per-agent language selection (20+ languages including Indian regional: Tamil, Hindi, Telugu, Kannada, Malayalam, Bengali, Gujarati, Marathi, Punjabi)
- Greeting message, end-call trigger phrases, backchannel (filler) phrases
- Agent knowledge base — attach documents/text for the agent to retrieve during calls
- Agent templates: Lead Qualifier, Appointment Scheduler, Customer Support, Sales SDR, Post-call Survey
- Active / inactive toggle per agent
- Per-agent call success metrics tracked automatically

### Real-Time Call Orchestration
- WebSocket-based streaming pipeline — audio flows in real time, never batched per call
- Barge-in / interruption detection — caller can interrupt agent mid-sentence
- Background denoising support
- Ambient sound overlay (office noise, café, hold music) to make calls feel natural
- Backchannel / filler phrases while the LLM thinks ("hmm", "sure", "got it") — customizable per agent
- Automatic call duration tracking and cost deduction from wallet

### Caller Memory
- Persistent memory store per caller phone number
- Agents automatically pick up context from past calls
- Memory injected into LLM context at session start — no repeated introductions

### Knowledge Base (AI)
- Full-text search over agent-attached knowledge
- Agents retrieve relevant chunks mid-call and incorporate into responses
- PostgreSQL-backed — no external vector DB required

### Outbound Campaigns
- Upload lead lists, set retry logic, schedule campaign windows
- Batch wizard UI to configure and launch
- Live queue view — see calls in progress per campaign
- Disposition tracking per lead (answered, no answer, busy, failed, etc.)
- CRM webhook delivery on call completion
- Callback scheduling — auto-schedule a return call when lead is unavailable

### Inbound Calls
- Route inbound calls to any configured agent
- Incoming call log with full transcript and status tracking
- DNC (Do Not Call) list checking — calls to blocked numbers are rejected automatically

### Call Transfers & Conferencing
- Transfer active calls to a human agent (warm or cold)
- Conference bridge support for three-way calls

### Web Embed (Webcall)
- One-line `<script>` embed for any website
- Opens a live browser-based voice call to the agent — no phone number needed
- Floating widget with real-time waveform and transcript display
- Customizable with `data-agent-id`, `data-name`, `data-color`
- Callback / auto-connect mode — call the visitor back automatically

### Smart Scheduling
- Built-in booking engine — no Calendly or third-party needed
- Multiple calendars per account
- Event types with custom duration, buffer time, and booking limits
- Weekly availability windows + date-specific overrides
- Timezone-aware slot generation
- Google Calendar sync (one-click OAuth, no setup required, multiple accounts supported)
- Public booking page at `/book/:slug` — shareable link for attendees
- Booking confirmation + reschedule / cancel self-service
- Email notifications (booking confirmation, cancellation, reschedule)
- Webhook dispatch on booking events for CRM / Zapier integration
- Double-booking prevention via advisory locks

### Phone Numbers
- Buy / rent virtual phone numbers directly from the dashboard (via Vobiz)
- Assign numbers to agents for dedicated inbound lines

### Analytics & Monitoring
- Dashboard: total agents, calls today, success rate %, average duration
- Call volume chart (daily)
- Call status breakdown (pie chart)
- Per-agent spend and success metrics
- Live call monitoring — inspect transcript, pipeline state, audio levels in real time without interrupting the agent

### Providers — full list

#### Speech-to-Text (ASR)
| Provider | Models |
|---|---|
| **Deepgram** | Nova-2, Nova-2 Phone Call, Nova-2 Meeting, Whisper Large |
| **Azure Speech** | en-US Standard, en-US Enhanced, en-IN Standard |
| **AssemblyAI** | Best, Nano (fast) |
| **Sarvam** (Indic languages) | Saarika v2.5, Saarika v2, Saarika Flash, Saaras v3 (streaming) |
| **Cartesia** | — |

#### Large Language Model (LLM)
| Provider | Models |
|---|---|
| **OpenAI** | GPT-4o Mini, GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Haiku |
| **Google Gemini** | Gemini 1.5 Flash, Gemini 1.5 Pro |
| **DeepSeek** | DeepSeek V3 (chat), DeepSeek R1 (reasoner) |
| **Mistral AI** | Mistral Large, Mistral Small, Mixtral 8x7B |
| **Cohere** | Command R+, Command R |
| **Qwen** (via Groq) | Qwen3-32B |
| **Sarvam** | Sarvam 30B, Sarvam 105B |

#### Text-to-Speech (TTS)
| Provider | Notes |
|---|---|
| **ElevenLabs** | Premium voice clones, multilingual |
| **Cartesia** (Sonic 3.5) | 42 languages, lowest latency |
| **OpenAI TTS** | Alloy, Echo, Fable, Onyx, Nova, Shimmer |
| **Deepgram Aura** | Aura-Asteria, Aura-Orion, Aura-Luna, Aura-Stella |
| **Azure TTS** | — |
| **Sarvam** (Bulbul) | Indic language voices |

#### Telephony
| Provider | Notes |
|---|---|
| **Twilio** | Global PSTN, SIP |
| **Plivo** | Global PSTN |
| **Vobiz** | Optimized for India |

---

## Languages supported

English (US, UK, AU), Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Gujarati, Marathi, Punjabi, French, German, Spanish, Portuguese, Italian, Dutch, Japanese, Korean, Chinese (Mandarin), Arabic, Ukrainian, Finnish, and more.

---

## Pricing

> **Model:** Pay per minute of orchestration. You pay your providers directly — SnapServe only charges for the orchestration layer.

| Plan | Price | Best for |
|---|---|---|
| **Developer** | $0.08 / min | Prototyping, side projects |
| **Production** | $0.12 / min | Live customer-facing agents |
| **Enterprise** | Custom | High-volume, dedicated infra |

### What's included at all tiers
- All provider integrations (ASR / LLM / TTS / Telephony)
- Persistent caller memory
- Call transcripts and analytics
- Webhook delivery
- Scheduling engine
- Web embed widget
- API access

### Production extras (over Developer)
- Ultra-low latency voice pipeline
- Smart SIP escalation (human handoff)
- Up to 500 concurrent calls

### Enterprise
- Dedicated infrastructure
- Custom model fine-tuning
- HIPAA & SOC2 compliance
- 24/7 Slack Connect support
- Unlimited concurrency

### Other costs
- **Welcome credit:** $5 free on signup — no card required
- **Minimum top-up:** $10
- **Extra concurrent call slots:** $5.00 each (beyond your plan's included slots)

---

## How it works (3-step flow)

1. **Connect your providers** — Add API keys for Deepgram, OpenAI, ElevenLabs, Twilio (etc.) in the Providers page. Keys are encrypted at rest — only the last 4 characters are ever shown.
2. **Build your agent** — Choose ASR + LLM + TTS + telephony, write a system prompt, configure language and voice. Deploy in under a minute.
3. **Start calling** — Embed the web widget on your site, trigger outbound calls via API, or route inbound numbers to the agent. SnapServe handles the full pipeline.

---

## API

```http
POST https://api.snapserve.ai/calls/outbound
Authorization: Bearer <API_KEY>

{
  "agent_id": "agt_8f2k9d",
  "to": "+14155550192"
}
```

- REST API + WebSocket streaming
- Webhook events on call complete, booking created, disposition set
- API key auto-provisioned on signup

---

## Auth / Onboarding

- **Sign in with Google** (one click, no account form)
- $5 free credit added automatically on first login
- API key and org key provisioned instantly

---

## What makes SnapServe different

| SnapServe | DIY approach |
|---|---|
| Provider-agnostic — swap any ASR/LLM/TTS | Locked to one provider's ecosystem |
| Caller memory built-in | Build and maintain yourself |
| Campaigns, scheduling, monitoring included | Separate tools + glue code |
| Pay for orchestration only | Margin hidden inside provider bundles |
| Production in an afternoon | Weeks of WebSocket plumbing |

---

## Use cases

- **Customer support bots** — Handle Tier-1 queries, escalate to human on complexity
- **Outbound sales / SDR** — Lead qualification at scale without a dialer team
- **Appointment scheduling** — Let callers book slots by voice; syncs to Google Calendar
- **Post-call surveys** — NPS and feedback collection after service interactions
- **Inbound IVR replacement** — Conversational routing instead of keypad menus
- **Web-embedded concierge** — Website widget that talks to visitors in real time
- **India-specific deployments** — Sarvam + Vobiz stack optimized for Tamil, Hindi, and other Indic languages on Indian telephony

---

## Footer links
- Privacy: `/privacy`
- Terms: `/terms`
- Docs: (TBD)
- Status: (TBD)
- Sales: `sales@snapserve.ai`

---

*Last updated: June 2026*
