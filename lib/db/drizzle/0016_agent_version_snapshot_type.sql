-- Add snapshot_type column to agent_versions to distinguish auto-saved drafts
-- from published/production snapshots.
-- Default 'published' so all existing rows are treated as published versions.

ALTER TABLE "agent_versions" ADD COLUMN IF NOT EXISTS "snapshot_type" text NOT NULL DEFAULT 'published';--> statement-breakpoint
