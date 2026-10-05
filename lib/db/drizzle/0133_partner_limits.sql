-- Migration: add per-partner agent and client limits
-- Both columns are nullable: NULL means no limit (unlimited).
-- Existing rows stay at NULL, so no existing partner is affected.

ALTER TABLE partners ADD COLUMN IF NOT EXISTS max_agents integer;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS max_clients integer;
