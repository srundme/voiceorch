---
name: Drizzle bootstrap migration gap
description: bootstrapMigrationJournal seeds old migrations as applied WITHOUT running their SQL — prod DBs miss tables/cols from un-seeded migrations; migrate() fails on 0000 (no IF NOT EXISTS) and never reaches new ones
---

## The rule
When adding new tables or columns, ALWAYS create a new migration file. After a migration is confirmed applied on all prod DBs, add its hash to the `KNOWN` array in `bootstrapMigrationJournal()`. Never leave gaps in the KNOWN list — any gap causes `migrate()` to re-try migration 0000 (`CREATE TABLE "users"` — no IF NOT EXISTS), fail silently via `.catch()`, and never reach the new migrations.

## Why
`bootstrapMigrationJournal()` seeds hashes for specific migrations into `drizzle.__drizzle_migrations` without running their SQL. Prod DBs bootstrapped via `drizzle-kit push` start with an empty (or absent) journal. On startup `migrate()` sees all un-seeded migrations as pending, tries to run 0000 first, fails because `users` table already exists (no IF NOT EXISTS guard), and the `.catch()` in `index.ts` swallows the error while keeping the server alive. Result: 0010, 0011, etc. never apply — new tables/columns are silently absent in production.

## How to apply
- New schema change → create `lib/db/drizzle/000N_description.sql` with `IF NOT EXISTS` guards
- Add entry to `lib/db/drizzle/meta/_journal.json` with a **strictly increasing** `when` epoch-ms timestamp (must be > all prior entries)
- Hash = SHA-256 of the SQL file content (verified: `crypto.createHash('sha256').update(content).digest('hex')`)
- Add the new migration's hash to KNOWN in `bootstrapMigrationJournal()` **only after** it has been successfully applied to all prod DBs

## Current KNOWN array covers
Migrations 0000–0009 are seeded. Migrations 0010, 0011, 0012 are applied via `migrate()` (not bootstrapped). After 0012 is confirmed applied to all prod DBs, add its hash to KNOWN:
- 0012_impersonation_exchange_code: `61096716f909fbf441e9d86d394610c34c609a61c5187d7b5ea44da8b6c155f9` (when: 1782450000000)

## PG16 gotcha: ADD CONSTRAINT IF NOT EXISTS is invalid syntax
`ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS` is NOT valid PostgreSQL syntax on PG 16 (and earlier). drizzle-kit generates this for unique constraints with IF NOT EXISTS — but it only works on PG 17+. Use a DO block with a pg_constraint pre-check instead:
```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'constraint_name') THEN
    ALTER TABLE tbl ADD CONSTRAINT constraint_name UNIQUE(col);
  END IF;
END $$;
```

## History
- Migrations 0010 (admin user mgmt cols) and 0011 (password_reset_otps) never applied to Railway prod, causing 500 on every password-reset request. Fixed by seeding 0003-0009 hashes so migrate() only runs 0010 and 0011.
- Also fixed 0011 journal `when` timestamp (was 1750300000000 / June 2025, corrected to 1782300000000 to maintain chronological order after 0010's 1782200000000).
- Migration 0012 (exchange_code + exchange_code_expires_at on admin_impersonation_sessions) was already in journal/SQL file; fix was confirming it propagates to Railway prod on next redeploy via migrate().
