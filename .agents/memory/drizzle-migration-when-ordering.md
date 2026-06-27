---
name: Drizzle migration when-timestamp ordering
description: Drizzle's migrate() uses the `when` field in _journal.json to decide which migrations to run; out-of-order timestamps permanently skip migrations
---

## Rule

Every migration's `when` in `lib/db/drizzle/meta/_journal.json` MUST be strictly greater than every previous migration's `when`. Drizzle's `migrate()` finds the highest `created_at` in `drizzle.__drizzle_migrations` and only runs migrations whose `folderMillis` (`when`) exceeds that value.

**Why:** `migration 0018_caller_preferred_language` had `when: 1782371989332`, lower than 0017's `1782900000000`. Even though 0019–0025 all ran and committed successfully (their `when` values are higher), 0018 was permanently skipped on every deploy. The `preferred_language` column was never added to `caller_profiles` in production, causing all caller-memory queries to fail with "column does not exist". The fix was migration 0026 with a higher `when` (`1783700000000`) that does `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

**How to apply:**
- When creating a migration file, always set `when` to `(last entry's when) + 100000` or larger — never reuse or backdate timestamps.
- If you suspect a migration was skipped, check: `SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5` in the production DB. If the migration's hash is absent but a later migration's hash is present, the `when` is the culprit.
- The remediation pattern is always a NEW migration with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (or equivalent idempotent DDL) — never edit an old migration's SQL, since the old migration may have already landed on some databases.
- Also watch for `0013_fix_calendar_timezone_default` which had `when: 1750512000000` (a 2025 timestamp) — corrected to `1782550000000` in the same batch.
