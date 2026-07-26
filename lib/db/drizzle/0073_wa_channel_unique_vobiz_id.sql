-- Cross-tenant guard: a VoBiz WhatsApp channel id may be claimed by at most one user.
CREATE UNIQUE INDEX IF NOT EXISTS "wa_channels_vobiz_channel_unique" ON "whatsapp_channels" ("vobiz_channel_id") WHERE vobiz_channel_id IS NOT NULL;
