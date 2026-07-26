---
name: Native WhatsApp two-tier architecture
description: Design decisions + invariants for the native VoBiz WhatsApp feature (shared vs own channel)
---

# Native VoBiz WhatsApp — two tiers

Two enrollment modes in one `whatsapp_channels` row per user (unique user_id):

- **shared** (default, zero setup): sends go out from the PLATFORM's SnapServe channel using master VoBiz creds + `platform_settings` config (channel id, WABA id, template catalog JSON keyed by hint). Rolling **24h per-user cap** (`dailyCap`, default 50) counted from `whatsapp_messages`.
- **own** (upgrade): user's WABA connected as a VoBiz channel **under their own sub-account**. The Meta access token is passed through to VoBiz at connect time and **never stored** (only `accessTokenLast4`). VoBiz treats the token as write-only.

The legacy BYO-BSP webhook feature (`whatsapp_connections`) still exists independently; per-agent BYO webhooks take precedence over native sends in the post-call dispatch.

## Invariants (violations were real review findings)

1. **Editing an enrolled channel must PATCH, never re-POST `/whatsapp/channel/shared`** — the shared enroll upsert deliberately nulls all own-channel fields, so an "edit" through it silently downgrades an own-tier user. Server also 409s shared enrollment while an own channel is active unless `switch: true`.
2. **Webhook signature check is fail-closed in production**: `VOBIZ_WA_WEBHOOK_SECRET` unset → reject (dev: accept + warn). Spoofed inbound events can otherwise trigger paid outbound dials (request-a-call intent).
3. **`vobiz_channel_id` has a partial unique index** (cross-tenant guard). Inbound attribution matches on channel id first (**active rows only**), then falls back to the latest outbound to that phone within 7d (shared tier).
4. **Linking an existing VoBiz channel** requires `wabaId` too (send path needs it), must not equal the platform shared channel id, and channel create/link uses strict sub-account creds (no master fallback), or the channel lands in the wrong VoBiz account.

## Why
Shared tier removes all onboarding friction (templates + Meta review already done by platform); own tier removes the cap and puts the user's brand/number on messages. Keeping both in one row keeps upgrade = upsert.
