# SnapServe end-to-end workflows

Base: `https://app.snapserve.ai/api`

## 1. Create an agent and place a test call

1. `create_agent` — name, `systemPrompt`, `language` (`en-IN`), providers
2. Optional: `attach_knowledge`, `set_disposition_config`
3. `assign_phone_number` (or tell user to buy in Dashboard)
4. `outbound_call` with E.164 `toNumber`
5. After hangup: `get_call` + `get_call_logs` for quality

## 2. Website form → automatic call

1. `create_campaign` with `agentId` + name (e.g. "Website leads")
2. `get_website_webhook` → copy `websiteLeadUrl`
3. User pastes into form / Sheet / Zapier:
   - `POST` JSON `{ "phone": "+91...", "name": "..." }`
4. Confirm lead: `list_campaign_leads`
5. Ensure campaign is active / batch started so dialing begins

Live path:

```
POST https://app.snapserve.ai/api/webhooks/lead/{webhookToken}
Content-Type: application/json

{"phone":"+919876543210","name":"Test"}
```

## 3. Journey (Event Outreach style)

1. `list_journey_presets`
2. `create_journey` then `apply_journey_preset`
3. Bind agent in journey settings / agent builder Journey tab
4. `activate_journey` → copy lead intake URL from journey (or campaign webhook)
5. Channels: WhatsApp Instant + Email ready before go-live

## 4. Google Sheets Automatic Calls

1. User connects Google in Dashboard → Sheets (OAuth)
2. `create_automatic_call` with sheet binding + agent
3. `start_automatic_call`
4. Monitor with `list_automatic_calls` / activity via `snapserve_api`

## 5. WhatsApp Instant (Voiceathon default)

1. `get_whatsapp_channel` — enable Instant if inactive
2. Attach agent in channel / journey
3. Avoid stale BYO BSP connection overriding Instant (`list_whatsapp_connections`)

## 6. CRM / Zap post-call webhook

- Agent field `webhookUrl` (HTTPS) via `update_agent`
- Or account `create_webhook_endpoint`
- Payload includes callId, status, transcript, disposition

## 7. Disposition taxonomy

```
set_disposition_config
  agentId: 415
  taxonomy: { "intent": ["interested","not_interested","callback"], "stage": ["new","followup"] }
```

## 8. Squad (multi-agent)

1. `list_squad_templates` / `create_squad`
2. Connect agents
3. `start_squad_run`

## 9. Debug bad call quality

1. `get_call` + `get_call_logs`
2. Check STT finals vs VAD gaps (deaf STT vs LLM failure)
3. Suggest Advanced → Engine patient Sarvam settings if choppy
