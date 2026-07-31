---
name: WhatsApp direct Meta Cloud API tier
description: Third WhatsApp send tier — direct Graph API using the client's own Meta token; precedence and gotchas.
---

Send precedence per agent connection (whatsapp_connections): **BYO webhook URL > direct Meta (metaAccessToken+metaPhoneNumberId) > native VoBiz channel**.

- Token stored AES-encrypted via encryptKey(); every read site must decryptKey() inside try/catch — decrypt failure must record lastError and continue, never abort the dispatch (architect-flagged).
- Templates are fetched live from Graph API (`/{wabaId}/message_templates`) — only APPROVED ones offered; linked per hint as {name, language, paramCount} in meta_templates jsonb.
- Params are positional {{1}}.. fitted to paramCount (truncate/pad "—"); order: business name, then summary / meeting time / link. Meta rejects empty params and newlines.
- Meta `to` is digits only (no +). Graph version pinned v21.0 in services/whatsapp/meta.ts.
- resolveMetaTemplate falls back hint→call_summary; no template linked = skip with log, not error.

**Why:** clients already have Meta WABA accounts + approved templates; direct connection removes the BSP/Zapier middleman.
