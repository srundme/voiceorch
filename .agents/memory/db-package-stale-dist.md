---
name: db schema edits need tsc -b lib/db
description: api-server typecheck resolves @workspace/db types from lib/db/dist .d.ts, which go stale after schema edits
---

Rule: after editing `lib/db/src/schema/*`, run `pnpm exec tsc -b lib/db/tsconfig.json` (from repo root) before trusting `pnpm --filter @workspace/api-server run typecheck`. Although package.json exports point at `./src/index.ts`, the TS project-reference build resolves the compiled `.d.ts` in `lib/db/dist` — stale declarations make brand-new tables/columns "not exist" in downstream typechecks.

**Why:** New whatsapp_assets/byon tables + channel columns produced a wall of TS2724/TS2339 errors that vanished entirely after rebuilding lib/db. lib/db has no `check`/`build` script of its own — only drizzle push scripts — so the rebuild is easy to forget.

**How to apply:** Any schema change. If api-server typecheck claims a column/table you just added doesn't exist, rebuild lib/db first, don't chase phantom code errors.
