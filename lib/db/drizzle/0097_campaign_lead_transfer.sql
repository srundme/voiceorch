-- Per-campaign disposition-gated lead transfer (webhook / Google Sheets)
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "lead_transfer" json;
