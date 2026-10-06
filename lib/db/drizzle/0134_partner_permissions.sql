-- Migration 0134: add partner permissions columns to users and partners tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_permissions jsonb;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS default_client_permissions jsonb;
