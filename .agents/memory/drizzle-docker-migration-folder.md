---
name: Drizzle migration folder in Docker
description: The lib/db/drizzle/ folder must be explicitly copied into the production Docker image stage; the production DB needs journal bootstrapping if it was created via drizzle-kit push.
---

## The rule
The Dockerfile production stage MUST include:
```
COPY --from=builder /workspace/lib/db/drizzle ./lib/db/drizzle
```
Without it, `migrate()` throws `Can't find meta/_journal.json file` at every startup. The server stays up (health check passes) but ALL DB queries fail silently because no schema changes ever applied.

## Why it bit us
The builder stage uses `COPY lib/ ./lib/` (captures everything), but the final production stage only copies built `dist/` + `package.json` files. The migration SQL folder lives in `lib/db/drizzle/` and was never forwarded.

## Pre-existing DB bootstrap
If the production DB was set up via `drizzle-kit push` (no journal), migrations 0000+0001 are already applied to the DB but not recorded. Running `migrate()` will try to re-run 0000 (bare `CREATE TABLE` without IF NOT EXISTS) and fail.

Fix: `bootstrapMigrationJournal()` in `artifacts/api-server/src/index.ts` runs before `migrate()`. It:
1. Checks if `users` table exists (= pre-existing DB)
2. Creates `drizzle.__drizzle_migrations` table if missing
3. Inserts known hashes for 0000 and 0001 if absent
4. `migrate()` then only applies truly new migrations

**Hashes (computed from file content SHA-256):**
- 0000_flashy_gargoyle: `e2b1a59f6d146aa9caa4a43233e860debafcf1655f7286a07f2c7c3c2519f559` (when: 1781539061605)
- 0001_production_schema_sync: `b7c04adb1d16b404a9cd1e22d854e7db01af1846504f561990a4b70bcf1a3b91` (when: 1781693800000)

**How to apply:** When adding a new migration file in future, also add its hash to the KNOWN list in `bootstrapMigrationJournal()` only if that migration is guaranteed to have been pre-applied to production via push.
