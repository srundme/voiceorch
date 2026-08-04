---
name: snapserve
description: >-
  Operate SnapServe (app.snapserve.ai) end-to-end: create and configure voice
  agents, place calls, run campaigns, link website forms, attach journeys,
  WhatsApp/email channels, Google Sheets automatic calls, knowledge bases,
  dispositions, squads, webcall links, wallet, and analytics. Use when the user
  mentions SnapServe, voice agents, campaigns, website webhooks, Voiceathon
  setup, or app.snapserve.ai — especially with SnapServe MCP tools connected.
---

# SnapServe (app.snapserve.ai)

SnapServe is an Indic-first AI voice agent platform. Prefer **SnapServe MCP tools**
when connected. Fall back to REST with `SNAPSERVE_API_KEY` — see `references/rest-api.md`
and `references/workflows.md`.

## Auth

- API key from **Dashboard → API Keys** (`sk_live_...`)
- Env: `SNAPSERVE_API_KEY`, optional `SNAPSERVE_BASE_URL` (default `https://app.snapserve.ai/api`)
- Header: `Authorization: Bearer sk_live_...`
- Never print the full key — only last 4 chars

## Product map (A→Z)

| Area | What users do | MCP / API |
|------|----------------|-----------|
| Agents | Create prompt, voice, tools, Advanced engine | `create_agent`, `update_agent` |
| Phone | Buy/assign DID | `list_phone_numbers`, `assign_phone_number` |
| Knowledge | Upload & attach KB | `attach_knowledge` |
| Calls | Outbound / review / logs | `outbound_call`, `get_call`, `get_call_logs` |
| Website linking | Form → lead → dial | `create_campaign` → `get_website_webhook` |
| Campaigns | CSV import, batches, redial | `import_campaign_leads`, `start_campaign_batch` |
| Journeys | Lead intake sequence | `apply_journey_preset`, `activate_journey` |
| WhatsApp | Meta Business / BYO BSP | `get_whatsapp_channel`, connections |
| Email | Brevo mid-call / post-call | `upsert_email_channel` |
| Sheets | Automatic Calls from rows | `create_automatic_call`, `start_automatic_call` |
| Dispositions | Post-call labels | `set_disposition_config` |
| CRM webhook | Post-call JSON to Zap/CRM | `update_agent` `webhookUrl` or webhook-endpoints |
| Squads | Multi-agent handoffs | `create_squad`, `start_squad_run` |
| Webcall | Browser test links | `create_webcall_link` |
| Wallet / analytics | Balance & performance | `get_wallet`, `get_analytics_dashboard` |

## Default stack (India / Voiceathon)

Prefer unless the user specifies otherwise:

- ASR: **sarvam** (`en-IN` or Indic)
- LLM: **google** (e.g. gemini flash)
- TTS: **cartesia** or **sarvam**
- Telephony: **vobiz**
- WhatsApp: **Meta Business API** (own number) or BYO BSP
- Website intake: campaign webhook `POST /api/webhooks/lead/{token}`

## Guardrails

1. Never invent transcripts, analytics, or IDs — fetch them.
2. Confirm before `delete_agent` / `delete_campaign` / releasing numbers.
3. Destructive call control (`end_call`) — confirm if the call is live production.
4. On 401 → ask user to rotate/create API key in Dashboard.
5. Payment/KYC/Razorpay purchase flows are browser-first; tell the user to complete in Dashboard when the API returns a payment URL.
6. For paths without a named MCP tool, use `snapserve_api`.

## Procedure

```
- [ ] 1. MCP available? Else curl/SDK with SNAPSERVE_API_KEY
- [ ] 2. Identify workflow (agent / campaign+website / journey / sheets / WA)
- [ ] 3. Read references/workflows.md for the matching recipe
- [ ] 4. Call tools; return IDs + URLs the user must paste (webhook, webcall)
- [ ] 5. Verify with get_call / list_campaign_leads / get_analytics_dashboard
```

## Install MCP

See `references/install-mcp.md`.
