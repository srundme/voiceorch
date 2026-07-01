---
name: VoBiz inbound "Error Reaching Answer URL" — diagnosis playbook
description: How to diagnose inbound VoBiz calls that hang up with "Error Reaching Answer URL"; what actually causes it and how to prove each layer against live prod
---

# VoBiz inbound "Error Reaching Answer URL"

**Symptom:** Inbound VoBiz call drops before any media. Status callback body shows
`HangupCauseName: Error Reaching Answer URL`, and the status handler logs
"no matching call in DB — ignoring" (no AI session ever started → no call record).

**What it means:** VoBiz/Plivo could not get a usable answer from the number's
answer_url — i.e. non-2xx, timeout, or unreachable host. It is DISTINCT from
"Invalid Answer XML" (a 200 with unparseable XML). It does NOT, by itself, tell you
which layer failed.

## Root causes (in observed likelihood order)
1. **Number not assigned to an agent** — inbound answer URL carries no `?agentId=`;
   it resolves the agent purely by the dialed To number in `phone_numbers`. If the row
   is missing or `agent_id` is NULL → the webhook returns **400 "Agent not configured
   for this number"** → this hangup cause. Assign the number to an agent to fix.
2. **Number linked to the wrong VoBiz Application** — a number explicitly linked to a
   specific app overrides the account `default_app`. The platform VoBiz account can hold
   stale apps (seen: an old `Bolna` app → api.bolna.ai, a dead `ngrok` dev-tunnel app).
   A SnapServe number linked to one of those hits a dead/foreign URL → this hangup cause.
   Fix = re-link the number to the "SnapServe" app (the per-number configure-webhook
   repair / wrench action, or PATCH the number's `application_id`).
3. **Stale answer_url on the SnapServe app itself** (wrong host). Less common now that
   the app answer_url is `https://app.snapserve.ai/...`.

**Why outbound works but inbound doesn't:** outbound dial appends `?agentId=` (and
`dir=out`) to the answer URL, so it never needs the To→agent lookup. Inbound has only
the lookup. Both share the same WS path `/api/ws/vobiz/:id`, so if outbound connects,
the WS layer is proven for inbound too.

## Direct-probe playbook (settle it WITHOUT the user, read-only)
Run via `node`/bash (secrets are in `process.env` there; the code_execution JS sandbox
has NO process.env). VoBiz REST base `https://api.vobiz.ai/api/v1/Account`, headers
`X-Auth-ID`/`X-Auth-Token` from `VOBIZ_AUTH_ID`/`VOBIZ_AUTH_TOKEN` (platform master).
- `GET /{authId}/Application/` → lists apps with their `answer_url` + `default_app`.
  Confirm the "SnapServe" app answer_url and that it's `default_app: true`.
- `GET /{authId}/numbers` (LOWERCASE; `/Number/` 401s) → `{ items:[{ id, e164,
  application_id }] }`. Confirm the dialed number's `application_id` == SnapServe app_id.
- `curl -sX POST https://app.snapserve.ai/api/webhooks/vobiz/voice`
  `-H 'Content-Type: application/x-www-form-urlencoded' --data 'To=<num>&From=...&CallUUID=diag'`
  → expect **200** + a `<Stream ...>wss://.../api/ws/vobiz/<agentId>?...</Stream>`. The
  path segment is the resolved agentId. The To lookup handles both `+` and no-`+` forms.
- WS upgrade probe **MUST use `--http1.1`** (curl otherwise negotiates HTTP/2 via ALPN,
  which has no Upgrade mechanism → Express falls through to a misleading 404):
  `curl -si --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket'
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='
  'https://app.snapserve.ai/api/ws/vobiz/<agentId>?...'` → expect **101 Switching Protocols**.

If all four pass, the current config is functional and the reported failure was a prior
misconfigured state — have the user place a fresh call to confirm.

## CRITICAL: prod DB is on Railway, NOT the Replit executeSql "production" replica
`executeSql({environment:"production"})` hits an unused/empty Replit-managed DB, not the
real Railway Postgres the deployed app uses (Railway deploys from `srundme/voiceorch`
main). Both the Replit dev and Replit "production" DBs can read as EMPTY while the live
Railway app has full data. Do NOT conclude "table is empty in prod" from executeSql — it
cannot reach Railway. Trust the live app UI / the provider API / user-supplied prod logs.
