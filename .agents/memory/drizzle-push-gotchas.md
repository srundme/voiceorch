---
name: drizzle-kit push gotchas
description: Why drizzle-kit push can loop forever ("Changes applied" every run) and how schema/DB drift hides until a push
---

# drizzle-kit push gotchas

## Long FK/constraint names cause an infinite "Changes applied" loop
Postgres truncates identifiers to 63 chars. Drizzle's auto-generated FK name is
`<table>_<col>_<reftable>_<refcol>_fk`, which easily exceeds 63 chars for long
table/column names. On push, Postgres stores the *truncated* name; on the next
push, drizzle compares its intended *full* name against the stored truncated one,
sees a mismatch, and recreates the constraint again — forever. Symptom:
`drizzle-kit push` prints `[✓] Changes applied` on every run instead of
`[i] No changes detected`.

**Fix:** give the constraint an explicit short name (≤63 chars). Use a
table-level `foreignKey({ columns, foreignColumns, name }).onDelete(...)` in the
pgTable third-arg array instead of inline `.references()`. Postgres's own default
name is `<table>_<col>_fkey`, which is short — matching that avoids a rename.

**Same class of bug for unique constraints:** column `.unique()` generates
`<table>_<col>_unique`, but Postgres's default is `<table>_<col>_key`. If the DB
was created outside drizzle, pass the exact name: `.unique("<table>_<col>_key")`.

## To verify a clean push non-interactively
`pnpm exec drizzle-kit push --config ./drizzle.config.ts --verbose` prints the
exact SQL it intends to run. `[i] No changes detected` = truly in sync. Plain
`pnpm run push` is interactive and aborts on a TTY error when it hits a
data-loss/truncate prompt — pipe `echo "" |` to surface the prompt text in logs.

## Columns/tables accessed only via raw SQL drift silently
If code reads/writes a column via `db.execute(sql\`...\`)` instead of the Drizzle
model, the column can exist in the DB but be absent from the schema. A blind
`push` would then DROP it (data loss). Keep the Drizzle schema describing every
live column/table, even legacy ones, so push stays non-destructive.
