---
name: VoBiz transfer UUID mismatch
description: VoBiz uses two distinct UUIDs — dial API call_uuid (REST-authoritative) vs stream/session callId — and only the dial UUID works with the Transfer API.
---

## The rule

The `call_uuid` returned by `POST /api/v1/Account/{authId}/Call/` (the dial API, captured by `dialVobiz()`) is the only UUID VoBiz recognises for REST mutations: Transfer, HangUp, etc.

`msg.start.callId` (WebSocket start event) and `req.body.CallUUID` (answer-webhook POST) are both stream-session identifiers. Using them for `/Call/{uuid}/Transfer/` returns `404 {"message":"Not Found"}`.

**Why:** VoBiz generates a REST call record (with a stable `call_uuid`) when the dial API is called. Separately, it creates a media-stream session (with its own ephemeral `callId`/`CallUUID`) when the WebSocket opens. The two UUIDs are different.

**How to apply:**

For *outbound campaign* calls (the only path where a pre-dial REST UUID is available):
1. `campaignCaller.ts` stores `dialVobiz()` return value in Redis under `vobiz:dial:campaignlead:{leadId}` (TTL 600 s).
2. `vobiz.ts` WS start-event handler fetches this key when `campaignLeadId` is set and uses it as the highest-priority `resolvedCallId` (above `urlCallUuid` and `callId`).

For *inbound* calls no pre-dial UUID exists; `urlCallUuid` (answer-webhook) is the best available fallback and appears to work in practice (inbound call_uuid == stream callId for inbound).
