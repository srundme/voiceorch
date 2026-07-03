---
name: snapserve
description: Manage SnapServe AI voice agents, phone calls, provider keys, phone numbers, and analytics via the SnapServe REST API. Use this skill whenever the user asks to create/list/update/delete a SnapServe voice agent, place or review a phone call, check call analytics, manage provider (ASR/LLM/TTS/telephony) keys, manage phone numbers, or check wallet/usage on SnapServe.
---

# SnapServe

SnapServe is an AI voice agent orchestration platform. This skill lets Claude manage a user's
SnapServe account (agents, calls, providers, phone numbers, analytics) directly through the
SnapServe REST API.

## Authentication

Every request needs a SnapServe API key, created by the user in **Dashboard → API Keys**
(`sk_live_...`, shown once at creation time). Ask the user for this key if it is not already
available as the `SNAPSERVE_API_KEY` environment variable, and never print the full key back —
only reference it by its last 4 characters.

All requests:

```
Authorization: Bearer sk_live_...
```

Base URL: `https://app.snapserve.ai/api` (or the user's own domain if self-hosted / staging).

## How to call the API

Prefer the official SDKs when the target environment already has Node.js or Python available —
they give typed helpers and consistent error handling:

- Node/TypeScript: `npm install @snapserve/sdk` — see `references/node-sdk.md`
- Python: `pip install snapserve` — see `references/python-sdk.md`

If neither runtime is convenient, call the REST API directly with `curl` — see
`references/rest-api.md` for the endpoint list and example payloads.

## Common tasks

- **"List my voice agents"** → `GET /agents`
- **"Create an agent named X using OpenAI + Deepgram"** → `POST /agents` with `asrProvider`,
  `llmProvider`, `ttsProvider`, `telephonyProvider` fields (see `references/rest-api.md` for the
  supported provider identifiers, drawn from the platform's provider docs).
- **"Call +1... with agent X"** → `POST /calls/outbound` with `{ agentId, toNumber }`
- **"How did agent X perform this week?"** → `GET /analytics/agents/{id}`
- **"Show today's call volume / dashboard"** → `GET /analytics/dashboard`
- **"Add my OpenAI key as a provider"** → `POST /providers` with `{ type: "llm", provider: "openai", apiKey }`
- **"What's my wallet balance?"** → `GET /wallet`

## Guardrails

- Never fabricate call transcripts, analytics numbers, or agent IDs — always fetch them from the API.
- Treat the API key as a secret: never echo it in full, never write it to a file the user didn't
  ask for, and never send it anywhere other than the SnapServe API host the user configured.
- Destructive calls (`DELETE /agents/{id}`, `DELETE /providers/{id}`, `DELETE /phone-numbers/{id}`,
  ending a live call) should be confirmed with the user before executing, since they can disable a
  live voice agent or drop an active phone call.
- If a request returns 401, the API key is invalid or revoked — ask the user to check
  Dashboard → API Keys rather than retrying with a guessed key.
- For anything not covered by `references/rest-api.md`, the full contract lives in the platform's
  OpenAPI spec at `/api-docs/openapi.yaml` (or ask the user for it) — do not guess field names for
  endpoints you have not seen documented.
