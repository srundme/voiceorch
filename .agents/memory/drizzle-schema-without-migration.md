---
name: Schema column with no migration bricks fresh DBs
description: How to detect and repair a column that exists in schema.ts + prod but was never given a migration file
---

# Schema/prod column with NO migration → fresh dev DBs break

A column can exist in `schema.ts` AND in the production DB (added long ago via `drizzle-kit push` or raw SQL) while **no migration file ever created it**. Any fresh database that only runs `migrate()` then lacks the column, and every query selecting it fails at runtime (e.g. a background sweep erroring every 15 min).

**Why:** `push` mutates the DB directly without writing a migration; the drift is invisible until a new environment is bootstrapped from migrations alone.

**How to apply:**
- Symptom: `column X does not exist` on a fresh/dev DB while prod is fine → suspect a push-created column, not a bad deploy.
- Repair = catch-up migration with **idempotent SQL** (`ADD COLUMN IF NOT EXISTS`) + a journal entry appended with a **fresh `when` greater than the last entry** (see drizzle-migration-when-ordering.md); prod re-runs it harmlessly.
- When adding any column, always create the migration file in the same change; never rely on push having done it.
