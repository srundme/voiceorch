---
name: Drizzle bootstrap migration gap
description: bootstrapMigrationJournal seeds old migrations as applied WITHOUT running their SQL — tables/columns added in those migrations are missing from Railway prod DB
---

## The rule
When adding new tables or columns to the Drizzle schema, ALWAYS create a new migration file. Never rely on `drizzle-kit push` keeping Railway's prod DB in sync — the `bootstrapMigrationJournal()` function in `index.ts` marks historical migrations as applied without executing their SQL.

## Why
`bootstrapMigrationJournal()` seeds hashes for migrations 0000–N into `__drizzle_migrations` without running the SQL. For Railway prod DBs bootstrapped via an older `drizzle-kit push`, any tables/columns added to migrations after the original push are never created. The `migrate()` call that follows skips those seeded entries and only runs truly new ones (higher `when` timestamp).

## How to apply
- New schema table or column → create a new `lib/db/drizzle/000N_description.sql` with `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`
- Add entry to `lib/db/drizzle/meta/_journal.json` with a fresh `when` epoch-ms timestamp
- Add the new migration's hash to `KNOWN` in `bootstrapMigrationJournal()` ONLY after it has been successfully applied to Railway prod (to prevent future double-runs on fresh DBs)
- `drizzle-orm migrate()` applies migrations whose `when` timestamp is greater than the last applied migration's `created_at` in `__drizzle_migrations` — so always use a strictly increasing timestamp

## History
Migration 0003 (ALTER TABLE columns) and 0004 (CREATE TABLE for agent_knowledge_sources, agent_dispositions, call_dispositions, call_events, execution_logs, agent_versions, simulation_test_cases, simulation_runs, simulation_messages) were created to fix a mass 500 error on all agents routes caused by missing tables/columns in Railway prod DB.
