-- Unguessable team invite tokens (replace serial ?teamId= links).
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "token" text;
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_token_unique" ON "team_members" ("token");
