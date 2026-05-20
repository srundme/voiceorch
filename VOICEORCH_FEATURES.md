# VoiceOrch — AI Agent Feature Reference

**Version:** Current (May 2026)  
**Model:** BYOK (Bring Your Own Key) — You supply API keys; VoiceOrch handles the orchestration.

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Provider Setup — API Keys Required](#2-provider-setup--api-keys-required)
   - 2.1 ASR (Speech-to-Text)
   - 2.2 LLM (Language Model)
   - 2.3 TTS (Text-to-Speech)
   - 2.4 Telephony
3. [Agent Configuration Features](#3-agent-configuration-features)
4. [Real-Time Pipeline Features](#4-real-time-pipeline-features)
5. [Post-Call Intelligence Features](#5-post-call-intelligence-features)
6. [Cross-Call Memory & Continuity Features](#6-cross-call-memory--continuity-features)
7. [Billing & Usage](#7-billing--usage)
8. [Webhooks & Integration](#8-webhooks--integration)
9. [Browser Test Calls (Webcall)](#9-browser-test-calls-webcall)
10. [Quick-Start Checklist](#10-quick-start-checklist)

---

## 1. Platform Overview

VoiceOrch is an AI voice agent orchestration layer. You configure agents with your own ASR + LLM + TTS + Telephony provider keys. The platform:

- Routes audio in real time through your chosen pipeline
- Handles speech recognition, language model turns, and text-to-speech
- Manages call lifecycle (inbound, outbound, transfers, callbacks)
- Stores call logs, transcripts, and analytics
- Runs post-call intelligence (summaries, disposition extraction, memory updates)

No provider fees pass through VoiceOrch — you pay providers directly. VoiceOrch charges only an orchestration fee per call minute.

---

## 2. Provider Setup — API Keys Required

All keys are stored in **Settings → Providers**. They are encrypted at rest and only the last 4 characters are shown in the UI.

---

### 2.1 ASR — Automatic Speech Recognition (Speech-to-Text)

| Provider | Key(s) Required | Where to Get | Extra Config |
|----------|----------------|--------------|--------------|
| **Deepgram** | `API Key` | [console.deepgram.com](https://console.deepgram.com) → API Keys | None |
| **Azure Speech** | `API Key` (Subscription Key) | Azure Portal → Cognitive Services → Keys and Endpoint | Add `{"region":"eastus"}` in Extra Config |
| **OpenAI Whisper** | `API Key` | [platform.openai.com](https://platform.openai.com) → API Keys | None |

**ASR features configurable per agent:**

| Feature | What it does |
|---------|-------------|
| Language | Forces recognition in a specific language (e.g. `en-US`, `hi-IN`) |
| Keyterms | Boost recognition accuracy for domain-specific words (comma-separated) |
| Background denoising | Filters background noise before transcription |
| Confidence threshold | Minimum confidence score to accept a word (0.0–1.0, default 0.40) |
| End-of-turn confidence | Threshold to detect when the caller has finished speaking (default 0.70) |
| End-of-turn timeout | Milliseconds of silence before declaring end-of-turn (default 5000ms) |
| Smart endpointing | `off` / `basic` / `aggressive` — controls how quickly the AI detects turn end |
| Auto-fallback | Falls back to a secondary ASR if the primary fails |

---

### 2.2 LLM — Language Model (AI Brain)

| Provider | Key(s) Required | Where to Get | Notes |
|----------|----------------|--------------|-------|
| **OpenAI** | `API Key` | [platform.openai.com](https://platform.openai.com) → API Keys | Supports GPT-4o, GPT-4-turbo, GPT-3.5-turbo |
| **Anthropic** | `API Key` | [console.anthropic.com](https://console.anthropic.com) → API Keys | Supports Claude 3.5 Sonnet, Claude 3 Opus/Haiku |
| **DeepSeek** | `API Key` | [platform.deepseek.com](https://platform.deepseek.com) | Supports deepseek-chat, deepseek-coder |
| **Mistral** | `API Key` | [console.mistral.ai](https://console.mistral.ai) → API Keys | Supports mistral-large, mistral-medium |
| **Cohere** | `API Key` | [dashboard.cohere.com](https://dashboard.cohere.com) → API Keys | Supports Command R+ |

**LLM is used for:**
- Real-time conversation turns during calls
- Post-call AI summary (3 bullet points)
- Caller memory extraction (name + context summary)
- Callback request detection ("call me back in X minutes")
- Disposition field extraction from transcripts
- Gender detection from voice transcript (internal provider)

---

### 2.3 TTS — Text-to-Speech

| Provider | Key(s) Required | Where to Get | Extra Config |
|----------|----------------|--------------|--------------|
| **ElevenLabs** | `API Key` | [elevenlabs.io](https://elevenlabs.io) → Profile → API Key | None |
| **OpenAI TTS** | `API Key` | [platform.openai.com](https://platform.openai.com) → API Keys | None |
| **AWS Polly** | `Access Key ID` (use as API Key) + `Secret Access Key` | AWS IAM → Create User → Programmatic access | Add `{"region":"us-east-1","secretAccessKey":"xxx"}` in Extra Config |
| **Azure TTS** | `API Key` (Subscription Key) | Azure Portal → Cognitive Services | Add `{"region":"eastus"}` in Extra Config |
| **Cartesia** | `API Key` | [cartesia.ai](https://cartesia.ai) → API Keys | None |
| **Deepgram TTS** | `API Key` | [console.deepgram.com](https://console.deepgram.com) → API Keys | None |

---

### 2.4 Telephony

| Provider | Key(s) Required | Where to Get | Extra Config (required) |
|----------|----------------|--------------|------------------------|
| **Twilio** | `Auth Token` | [console.twilio.com](https://console.twilio.com) → Account Info | `{"accountSid":"ACxxxxxxxxxx","fromNumber":"+1xxxxxxxxxx"}` |
| **Plivo** | `Auth Token` | [console.plivo.com](https://console.plivo.com) → API | `{"authId":"MAxxxxxxxxxx","fromNumber":"+1xxxxxxxxxx"}` |
| **Vobiz** | `Auth Token` | Vobiz dashboard → API credentials | `{"authId":"MA_xxxxxxxxxx","fromNumber":"+1xxxxxxxxxx"}` |
| **Vonage** | `API Secret` | [dashboard.nexmo.com](https://dashboard.nexmo.com) → API Settings | `{"apiKey":"xxxxxxxx","fromNumber":"+1xxxxxxxxxx"}` |

> **Extra Config** is a JSON object entered in the provider form. It stores non-secret config (account IDs, from-numbers) alongside the API key.

**Inbound calls:** Configure your telephony provider webhook to point to:
```
https://<your-domain>/api/webhooks/<provider>/voice?agentId=<id>
```

**Outbound calls:** Use `POST /api/calls/outbound` with `{ agentId, toNumber }`.

---

## 3. Agent Configuration Features

Each agent is configured independently with its own pipeline and behavior settings.

### 3.1 Core Pipeline

| Setting | Description |
|---------|-------------|
| **Name** | Agent display name (also available as `{agent_name}` variable in prompts) |
| **System Prompt** | The agent's personality, role, and instructions |
| **ASR Provider + Model** | Which speech recognition engine to use |
| **LLM Provider + Model** | Which AI model drives the conversation |
| **TTS Provider + Voice + Model** | Which voice synthesis engine and voice to use |
| **Telephony Provider** | Which carrier handles the phone calls |
| **Temperature** | LLM creativity (0.0 = deterministic, 1.0 = creative) |
| **Language** | Primary language for ASR and conversation |
| **Max Duration** | Hard cap on call length in seconds (default 600 = 10 min) |

### 3.2 Dynamic Prompt Variables

Use these placeholders in your system prompt — they are auto-substituted before each call:

| Variable | Value injected |
|----------|---------------|
| `{agent_name}` or `{{agent_name}}` | Agent's configured name |
| `{caller_number}` or `{{from_number}}` | Inbound caller's phone number |
| `{{to_number}}` | Number being called (outbound) |
| `{date}` | Current date (e.g. "Tuesday, May 20, 2026") |
| `{caller_salutation}` | Runtime-resolved salutation based on gender detection (sir / ma'am / custom) |

### 3.3 Greeting Message

Pre-recorded or LLM-generated opening line spoken immediately when the call connects. If left blank, the AI generates a natural opening based on the system prompt.

### 3.4 End-Call Phrases

Comma-separated list of phrases that trigger automatic call termination when the AI says them.

Example: `"Goodbye, have a great day", "Take care", "Bye bye"`

### 3.5 Silence Timeout & Inactivity Message

| Setting | Description |
|---------|-------------|
| **Silence timeout (seconds)** | Seconds of caller silence before action is taken |
| **Inactivity message** | What the AI says when silence is detected ("Are you still there?") |

### 3.6 Backchanneling

When enabled, the AI inserts brief acknowledgements ("I see", "Got it", "Mmm-hmm") while the caller is speaking to make the conversation feel more natural.

| Setting | Description |
|---------|-------------|
| **Enabled** | Toggle on/off |
| **Frequency** | How often backchannels are inserted (low / medium / high) |

### 3.7 Noise Cancellation

Enables server-side background noise filtering on the incoming audio stream before ASR processing. Useful for callers in noisy environments.

### 3.8 Tools (Function Calling)

Agents can be equipped with tools that allow them to take actions mid-call:

| Tool | What it does |
|------|-------------|
| **Call Transfer** | Transfers the call to a specified phone number or SIP address |
| *(More tools can be added via the tools JSON config)* | |

### 3.9 Disposition Schema

Define a structured data form that the AI fills out from the call transcript. Each field has:
- **Key** — machine name
- **Label** — human-readable name
- **Type** — `text`, `boolean`, `number`, `choice`
- **Options** — for `choice` type (e.g. "interested", "not_interested", "callback")
- **Required** — whether the field must be populated

Results are automatically extracted post-call and saved with the call record.

### 3.10 Webhook URL

A URL that receives a POST request after every call completes, with full call data:
```json
{
  "callId": 123,
  "agentId": 1,
  "agentName": "Sales Agent",
  "status": "completed",
  "durationSeconds": 142,
  "transcript": "...",
  "avgSttLatencyMs": 210,
  "avgLlmLatencyMs": 340,
  "avgTtsLatencyMs": 180,
  "endedAt": "2026-05-20T10:30:00.000Z"
}
```

---

## 4. Real-Time Pipeline Features

These run during an active call.

### 4.1 Gender Detection + Caller Salutation

**Requires:** LLM provider key configured.

When enabled, the AI detects the caller's likely gender from voice characteristics and spoken content during the first 20–30 seconds of the call. It then substitutes `{caller_salutation}` in the system prompt with the appropriate term.

| Agent Setting | Description |
|--------------|-------------|
| **Enable gender detection** | Toggle on/off |
| **Detection provider** | `internal` (transcript-based) or external |
| **Male salutation** | What to call male callers (default: "sir") |
| **Female salutation** | What to call female callers (default: "ma'am") |
| **Neutral salutation** | What to use when gender is unclear (default: empty) |

Set to `"skip"` in any salutation field to suppress the salutation entirely for that gender.

**How it works:** After gender is detected, the system prompt is rewritten mid-call with the correct salutation filled in. The pipeline reprocesses the prompt so subsequent LLM turns use the updated version.

### 4.2 Handoff Detection

Automatically detects when a call should be handed off to a human agent based on:
- Trigger phrases in the conversation ("speak to a human", "transfer me", "agent please")
- 3-second silence after a handoff keyword is detected

When handoff is detected, the call is transferred and the agent's state is reset so the next speaker gets fresh gender detection.

### 4.3 Barge-In (Interruption Handling)

The caller can interrupt the AI mid-sentence. When voice activity is detected while the AI is speaking, the AI stops immediately and listens.

### 4.4 Real-Time Latency Metrics

Per-turn metrics are tracked and logged:
- **STT latency** — time from end-of-speech to transcript available
- **LLM latency** — time from transcript to first LLM token
- **TTS first-chunk latency** — time from LLM response to first audio byte

Averages are stored with each call record for performance monitoring.

---

## 5. Post-Call Intelligence Features

These run automatically after every call ends. All are fire-and-forget — they don't affect call termination speed.

### 5.1 AI Call Summary

**Requires:** LLM provider key configured.

Generates 3 concise bullet points covering:
- Main topic of the call
- Key outcomes or decisions
- Action items or follow-ups

Stored with the call record and visible in the Calls Log.

### 5.2 Disposition Extraction

**Requires:** LLM provider key + Disposition Schema configured on the agent.

The LLM reads the full transcript and fills in each field defined in the disposition schema. Results are stored as structured JSON with the call record.

### 5.3 Caller Memory Update

**Requires:** LLM provider key configured.

At the end of every call, the LLM extracts:
- **Caller name** (if mentioned during the call)
- **Summary** (1–3 sentences: interests, issues, preferences, follow-ups)

This is merged with any existing profile for that caller and stored in the `caller_profiles` database. The next call from the same number automatically gets this context injected.

---

## 6. Cross-Call Memory & Continuity Features

### 6.1 Caller Memory (Persistent Across Calls)

**Requires:** Nothing extra — works automatically for all telephony calls.
**Does not apply to:** Webcall (browser test calls — no stable phone number).

Every caller is identified by their phone number + agent combination. On each new call:

1. The system checks if a profile exists for that number
2. If yes, a memory block is prepended to the system prompt:

```
=== CALLER MEMORY (from previous calls) ===
Name: Rahul Sharma
Previous calls with this agent: 3
Last call: 2 days ago
Context: Looking for 3BHK in Bandra. Budget ₹2.5 crore. Prefers morning callbacks.
===========================================
```

3. The AI uses this context immediately from the first word of the call

Memory accumulates and improves over successive calls.

### 6.2 Dropped Call Detection & Continuation

**Requires:** Nothing extra — automatic.

**Scenario:** AI and customer are mid-conversation. The call drops unexpectedly. The customer calls back.

**How it works:**
- When a call ends without a deliberate end-call phrase, silence timeout, transfer, or max duration trigger — and the call lasted more than 15 seconds — it is flagged as "dropped" in the caller's profile
- When the same number calls back within **60 minutes**, the memory block is updated with a continuation cue:

```
Last call: today (call dropped — this is a continuation)
IMPORTANT: The previous call was disconnected unexpectedly. This caller is 
calling back. Resume naturally from where you left off — acknowledge the drop 
briefly and continue the conversation without starting over.
```

The AI acknowledges the disconnection naturally (not with a scripted message) and resumes from the context of the previous conversation.

### 6.3 Scheduled Callbacks ("Call me back in 10 minutes")

**Requires:** Telephony provider configured with `accountSid`/`authId` + `fromNumber` in Extra Config.

**Scenario:** During a call, the customer says "call me back in 10 minutes" or "ring me after half an hour".

**How it works:**
1. Post-call, the LLM scans the transcript for callback requests and extracts the delay in minutes
2. A scheduled callback record is created in the database
3. A background job polls every 30 seconds for due callbacks
4. When the time arrives, the system automatically dials the customer using the agent's configured telephony provider
5. When the customer picks up, the call starts with full context from the previous conversation (via caller memory)

The AI greets them with awareness of the callback: "Hi, I'm calling you back as you requested — continuing from our earlier conversation about..."

---

## 7. Billing & Usage

### 7.1 Orchestration Fee (VoiceOrch charge)

| Call Duration | Fee |
|--------------|-----|
| Under 30 seconds | $0.015 flat |
| 30 seconds and above | $0.03 per minute (rounded up to next full minute) |

Example: A 2 min 15 sec call = 3 minutes × $0.03 = **$0.09**

### 7.2 Wallet

- Users pre-load a wallet balance
- Balance is checked before each call — calls are blocked if balance is zero
- Concurrent call limits are enforced per agent

### 7.3 Provider Costs (Separate — Paid Directly to Providers)

You are billed directly by each provider for their services. Typical ranges:

| Service | Typical Cost |
|---------|-------------|
| Deepgram ASR | ~$0.0043/min |
| OpenAI Whisper | $0.006/min |
| OpenAI GPT-4o | ~$0.005–$0.015 per 1K tokens |
| ElevenLabs TTS | ~$0.30/1K characters |
| Twilio (phone) | ~$0.013/min + $1/month/number |

---

## 8. Webhooks & Integration

### 8.1 Inbound Call Webhook URLs

Configure these in your telephony provider dashboard:

| Provider | Voice Webhook URL | Status Callback |
|----------|------------------|-----------------|
| Twilio | `POST https://<domain>/api/webhooks/twilio/voice?agentId=<id>` | `POST https://<domain>/api/webhooks/twilio/status` |
| Plivo | `POST https://<domain>/api/webhooks/plivo/voice?agentId=<id>` | — |
| Vobiz | `POST https://<domain>/api/webhooks/vobiz/voice?agentId=<id>` | `POST https://<domain>/api/webhooks/vobiz/status` |

### 8.2 Post-Call Webhook (Agent Setting)

Configure a webhook URL on any agent to receive full call data when each call completes. Useful for CRM integration, ticketing, or custom analytics.

### 8.3 REST API

| Endpoint | Description |
|----------|-------------|
| `POST /api/calls/outbound` | Initiate an outbound call |
| `PATCH /api/calls/:id/end` | Manually end a call |
| `GET /api/calls` | List call history |
| `GET /api/agents` | List agents |
| `POST /api/agents` | Create agent |
| `PATCH /api/agents/:id/toggle` | Toggle agent active/inactive |
| `GET /api/analytics/...` | Dashboard analytics |

---

## 9. Browser Test Calls (Webcall)

**No telephony provider needed** — runs directly in the browser over WebSocket.

Use this to test your agent's LLM, ASR, and TTS configuration without consuming telephony minutes or needing a phone number.

**What works in webcall:**
- Full ASR → LLM → TTS pipeline
- System prompt, temperature, voice settings
- Greeting message
- End-call phrases
- Backchanneling
- Silence timeout
- Gender detection

**What doesn't apply:**
- Cross-call caller memory (no stable phone number)
- Dropped call continuation
- Scheduled callbacks
- Webhooks

**Billing:** Webcall uses the same tiered billing as telephony calls.

---

## 10. Quick-Start Checklist

To run a fully functional AI voice agent:

### Minimum (for browser testing)

- [ ] Add an **LLM provider key** (e.g. OpenAI) → Providers page
- [ ] Add a **TTS provider key** (e.g. ElevenLabs) → Providers page
- [ ] Add an **ASR provider key** (e.g. Deepgram) → Providers page
- [ ] Create an **agent** with system prompt, and select your providers
- [ ] Click **Test Call** on the agent — opens browser audio

### For Live Phone Calls (Inbound)

- [ ] All of the above
- [ ] Add a **Telephony provider key** (e.g. Twilio Auth Token) with Extra Config `{"accountSid":"ACxxx","fromNumber":"+1xxx"}`
- [ ] In Twilio console, set the voice webhook to `https://<domain>/api/webhooks/twilio/voice?agentId=<id>`
- [ ] Fund your VoiceOrch wallet

### For Outbound Calls & Scheduled Callbacks

- [ ] All of the above (telephony required)
- [ ] Ensure the agent's telephony provider has `fromNumber` set in Extra Config
- [ ] Use `POST /api/calls/outbound` or let the AI schedule it from a "call me back" request

### To Enable Advanced Features

| Feature | What to do |
|---------|-----------|
| Caller memory | Nothing — automatic for all telephony calls |
| Dropped call continuation | Nothing — automatic |
| Scheduled callbacks | Telephony provider with Extra Config (fromNumber) |
| Gender detection | Enable in agent settings → Gender Detection section |
| Disposition extraction | Define disposition schema in agent settings |
| Post-call summary | Nothing — automatic when LLM key is present |
| Post-call webhook | Add webhook URL in agent settings |

---

*Generated from VoiceOrch platform as of May 2026.*
