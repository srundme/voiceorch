# SnapServe REST API — quick reference

Base URL: `https://app.snapserve.ai/api`
Auth header on every request: `Authorization: Bearer sk_live_...`

## Agents

| Method | Path | Purpose |
|---|---|---|
| GET | `/agents` | List all agents |
| GET | `/agents/{id}` | Get one agent |
| POST | `/agents` | Create an agent |
| PATCH | `/agents/{id}` | Update an agent |
| DELETE | `/agents/{id}` | Delete an agent |
| PATCH | `/agents/{id}/toggle` | Toggle active/inactive |

Key `POST /agents` body fields: `name`, `asrProvider`, `llmProvider`, `ttsProvider`,
`telephonyProvider`, `language`, plus per-provider config (voice, model, system prompt). Supported
providers — ASR: Deepgram, Azure, Whisper. LLM: OpenAI, DeepSeek, Anthropic, Mistral, Cohere. TTS:
ElevenLabs, OpenAI, AWS Polly, Azure, Cartesia, Deepgram. Telephony: Twilio, Plivo, Vonage.

## Calls

| Method | Path | Purpose |
|---|---|---|
| GET | `/calls?agentId=&status=` | List calls, optionally filtered |
| GET | `/calls/{id}` | Get one call (includes transcript/summary once ended) |
| POST | `/calls/outbound` | Place an outbound call: `{ agentId, toNumber }` |
| POST | `/calls/{id}/transfer` | Transfer an active call: `{ to }` |
| PATCH | `/calls/{id}/end` | End an active call |
| PATCH | `/calls/{id}/disposition` | Set/override disposition fields |

## Providers (your ASR/LLM/TTS/telephony keys)

| Method | Path | Purpose |
|---|---|---|
| GET | `/providers` | List configured provider keys (masked) |
| POST | `/providers` | Add a key: `{ type, provider, apiKey }` |
| PATCH | `/providers/{id}` | Update a key |
| DELETE | `/providers/{id}` | Remove a key |

`type` is one of `asr`, `llm`, `tts`, `telephony`.

## Phone numbers

| Method | Path | Purpose |
|---|---|---|
| GET | `/phone-numbers` | List owned numbers |
| GET | `/phone-numbers/available?countryCode=` | Search numbers to purchase |
| PATCH | `/phone-numbers/{id}/assign` | Assign/unassign to an agent: `{ agentId }` |
| DELETE | `/phone-numbers/{id}` | Release a number |

## Analytics

| Method | Path | Purpose |
|---|---|---|
| GET | `/analytics/dashboard` | Overview stats |
| GET | `/analytics/calls/recent` | Last 20 calls |
| GET | `/analytics/calls/by-status` | Call counts by status |
| GET | `/analytics/calls/daily` | Daily call volume (7 days) |
| GET | `/analytics/agents/{id}` | Per-agent stats |

## Webhooks

| Method | Path | Purpose |
|---|---|---|
| GET | `/webhook-endpoints` | List endpoints |
| POST | `/webhook-endpoints` | Create: `{ url, events }` |
| PATCH | `/webhook-endpoints/{id}` | Update |
| DELETE | `/webhook-endpoints/{id}` | Delete |

## Wallet & account

| Method | Path | Purpose |
|---|---|---|
| GET | `/wallet` | Balance and auto-pay settings |
| GET | `/wallet/transactions?limit=&offset=` | Transaction history |
| GET | `/account` | Account keys and concurrency limit |

## Scheduling

| Method | Path | Purpose |
|---|---|---|
| GET | `/scheduling/calendars` | List calendars |
| GET | `/scheduling/event-types` | List bookable event types |
| GET | `/scheduling/bookings` | List bookings |
| GET | `/scheduling/public/slots?slug=&timeZone=` | Public (no-auth) open slots |
| POST | `/scheduling/public/bookings` | Public (no-auth) booking creation |

This is the common subset. The platform has many more endpoints (campaigns, knowledge base, KYC,
CRM connectors, etc.) — for anything not listed here, ask the user for the full
`lib/api-spec/openapi.yaml` contract or the live `/api-docs` reference before guessing a payload
shape.
