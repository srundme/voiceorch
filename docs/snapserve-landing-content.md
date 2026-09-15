# SnapServe — Landing Page Content

## Positioning
**SnapServe** is the AI voice agent orchestration platform built for teams that want production-grade voice AI without the infrastructure overhead. Bring your own provider keys or use SnapServe's managed stack — either way, your agents are live in minutes.

---

## Hero Section

### Headline
**Deploy AI Voice Agents That Actually Work**

### Subheadline
Orchestrate speech recognition, language models, and voice synthesis across any provider — Twilio, ElevenLabs, Deepgram, OpenAI, and more — with a single platform. No infra babysitting.

### CTA Buttons
- **Get Started Free** → (sign up)
- **See a Live Demo** → (webcall demo)

### Social Proof Line
*Used by sales teams, insurance agencies, and support operations to run thousands of calls per month.*

---

## Problem Section

### Headline
**Building voice agents is harder than it looks**

### Pain Points

| What you expect | What actually happens |
|---|---|
| "Just plug in an API key" | You're managing 4 providers, 3 SDKs, and a fragile websocket |
| "Low latency" | 3-second delays because nothing is warm |
| "Reliable transcription" | STT cuts out mid-sentence, especially for non-English |
| "Easy to swap providers" | Locked in to one vendor's quirks |
| "Call analytics" | CSV exports and manual spreadsheets |

---

## Solution Section

### Headline
**One platform. Any provider. Real calls.**

### Description
SnapServe abstracts the entire voice pipeline — from telephony to STT to LLM to TTS — into a clean orchestration layer. Configure your agent once. SnapServe handles the rest: turn management, barge-in detection, fallback chains, endpointing, and call recording.

---

## Features Section

### Core Features

#### 🎙️ Multi-Provider Support
Connect ASR (Deepgram, Azure, Sarvam, Whisper), LLM (OpenAI, DeepSeek, Anthropic, Mistral, Cohere), TTS (ElevenLabs, Cartesia, AWS Polly, Azure, Deepgram), and Telephony (Twilio, Plivo, Vonage) — mix and match with zero code changes.

#### 🔑 Bring Your Own Providers (BYOP)
Add your own API keys in the Providers page and pay only **$0.035/min** orchestration fee. Or let SnapServe supply all keys at **$0.05/min**. Switch modes any time — billing resolves dynamically at call end.

#### ⚡ Low-Latency Pipeline
Keep-alive HTTP pools, WebSocket streaming STT, and sentence-level TTS streaming keep first-word latency under 800ms on a warm call.

#### 🌐 10+ Indian Languages
Native support for Tamil, Hindi, Kannada, Telugu, Malayalam, and more via Sarvam AI. Codemix mode handles real-world code-switched speech (Tamil + English in the same sentence).

#### 📞 Web & Phone Calls
Test agents in-browser (no phone needed) or deploy to real phone numbers via Twilio/Plivo/Vonage — same agent config, same pipeline.

#### 🛡️ Production-Grade Reliability
Automatic turn safety nets: if STT stalls, SnapServe force-finalises from the best partial and reprompts. If silence continues, it gracefully ends the call. No infinite listening hangs.

#### 📊 Real-Time Analytics
Dashboard with call volume charts, success rate, average duration, and status breakdowns. Full call transcripts with timestamps.

#### 🗓️ Built-In Scheduling
Multi-tenant booking engine with Google Calendar sync, availability windows, slot locking, email confirmations, and public booking pages — all in the same platform.

---

## How It Works

### Step 1 — Create Your Agent
Define your agent's name, persona, system prompt, and which ASR + LLM + TTS + telephony provider to use. Takes 2 minutes.

### Step 2 — Add Provider Keys (optional)
Paste in your API keys for any provider. SnapServe encrypts them at rest. If you skip this, SnapServe's managed keys power your agents automatically.

### Step 3 — Go Live
Start a web test call instantly. Assign a phone number for inbound calls. Launch outbound campaigns. Your agent is live.

---

## Pricing Section

### Headline
**Simple, usage-based pricing**

### Plans

#### Managed
> **$0.05 / minute**
- SnapServe provides all provider keys
- ASR + LLM + TTS + Telephony included
- Best for teams who want zero ops
- Start immediately, no third-party accounts needed

#### BYOP — Bring Your Own Providers
> **$0.035 / minute**
- Orchestration fee only
- You bring your own API keys
- Full provider flexibility
- Best for teams with existing contracts

*No seats, no per-agent fees, no monthly minimums. Pay only for what you use.*

---

## Use Cases Section

### Who Uses SnapServe

#### 📦 Insurance & Financial Services
Outbound policy renewal reminders, lead qualification, and appointment booking — automated calls that sound human and handle objections.

#### 🏠 Real Estate
AI agents that call leads, qualify buyers and renters, and book site visits — in the caller's language.

#### 🛎️ Customer Support
24/7 first-line voice support that resolves tier-1 queries, escalates intelligently, and logs every call with a transcript.

#### 📅 Appointment-Based Businesses
Clinics, salons, consultants — automate scheduling, reminders, and confirmations without a receptionist.

#### 🏭 Sales Teams
Scale outbound prospecting without scaling headcount. Each AI agent handles hundreds of concurrent calls.

---

## Comparison Section

### Headline
**SnapServe vs. building it yourself**

| Capability | DIY | SnapServe |
|---|---|---|
| Multi-provider support | Weeks of integration work | Day one |
| Barge-in + endpointing | 6-month research problem | Built-in |
| Indian language support | Limited / experimental | Production-ready |
| Turn safety nets | None (silent hangs) | Automatic |
| Analytics dashboard | Custom build | Included |
| Scheduling + calendar sync | Separate product | Included |
| Time to first call | Weeks | Minutes |
| Ongoing infra | Your problem | Our problem |

---

## Social Proof / Testimonials

*(Placeholder — replace with real customer quotes)*

> *"We went from zero to 300 calls a day in under a week. The managed plan meant no DevOps overhead at all."*
> — Head of Sales Ops, D2C startup

> *"Sarvam integration works better here than anything we tried ourselves. Tamil codemix transcription is finally usable."*
> — CTO, Regional Insurance Broker

> *"BYOP mode let us keep our Deepgram and ElevenLabs contracts. We just moved the orchestration to SnapServe."*
> — Engineering Lead, BPO

---

## FAQ Section

**What is a voice agent?**
A software bot that can hold a real phone or web conversation — listening, understanding, responding — powered by speech recognition, a language model, and a text-to-speech voice.

**Do I need any API keys to start?**
No. Choose the Managed plan and SnapServe provides everything. You can add your own keys later to switch to BYOP pricing.

**What languages are supported?**
English, Hindi, Tamil, Kannada, Telugu, Malayalam, Bengali, Gujarati, Marathi, Punjabi, and Odia. Codemix mode handles mixed-language conversations naturally.

**Can I use my existing Twilio number?**
Yes. Bring your Twilio, Plivo, or Vonage credentials in the Providers page and point your existing number's webhook to SnapServe.

**Is call data secure?**
All provider keys are encrypted at rest (AES-256-GCM). Call recordings are stored in your account only. DPDP-compliant data retention and erasure workflows are built in.

**What's the latency?**
Typical first-word response on a streaming call is under 1 second. SnapServe uses keep-alive HTTP pools and WebSocket streaming to minimise per-turn handshake overhead.

**Is there a free trial?**
Yes — new accounts receive $5 in free credits on sign-up. No credit card required.

---

## Footer CTAs

### Primary
**Start building for free →**

### Secondary
- Book a 20-minute demo
- Read the docs
- See pricing

---

## Meta / SEO

**Title:** SnapServe — AI Voice Agent Orchestration Platform
**Description:** Deploy production-grade AI voice agents in minutes. Multi-provider support (Twilio, ElevenLabs, Deepgram, OpenAI), Indian language support, BYOP pricing. Start free.
**Keywords:** AI voice agent, voice bot platform, speech orchestration, IVR replacement, conversational AI India, Twilio voice AI, Deepgram, ElevenLabs, Sarvam AI, outbound calling AI
