---
name: Identity relink targets must track user-scoped tables
description: When adding any user-scoped table, also add it to IDENTITY_RELINK_TARGETS or account merges will orphan that data.
---

# Identity relink targets

`lib/db/src/identity-merge.ts` holds `IDENTITY_RELINK_TARGETS` — the hand-maintained
list of every table/column that references a user identity (by `clerk_id` string or
`users.id`). It powers both the one-off `merge-user-identities` script AND the
Google-login auto-linking (`linkLegacyIdentitiesAtLogin`).

**Rule:** any time you add a new table (or column) that is scoped to a user, add it to
`IDENTITY_RELINK_TARGETS` with the right conflict flags (`unique` / `uniqueWith`).

**Why:** the list is NOT derived from schema/FKs at runtime. If a user-scoped table is
missing, a future account merge will leave that table's rows pointing at the deleted
legacy identity → silently orphaned/lost data. There is no automatic check.

**How to apply:**
- Canonical user identity = the **bare-numeric Google `sub`** (matches `req.clerkUserId`
  / session sub / prod `users.clerk_id`). Never reintroduce a `google:` prefix — it
  would be a third id format nothing else matches.
- Tables keyed by the clerk_id string vs by `users.id` are handled differently in
  `executeMergeGroup` (FK-safe order); follow the existing entry shape.
- `email:`-prefixed rows are separate password accounts and are **never** merged.
