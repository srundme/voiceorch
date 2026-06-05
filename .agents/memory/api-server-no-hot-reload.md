---
name: api-server bundle has no hot-reload
description: Backend route/middleware changes don't take effect until the api-server workflow is restarted
---

The `artifacts/api-server` dev workflow runs `pnpm run build && pnpm run start`
— an esbuild bundle (`dist/index.mjs`) executed by plain `node`. It does NOT
watch source files.

**Symptom:** after editing routes/middleware, new endpoints return 404 and old
behavior persists even though `pnpm run typecheck` passes and Vite-based
frontends hot-reload fine.

**Fix:** restart the `artifacts/api-server: API Server` workflow after any
backend source change before smoke-testing via curl.

**How to apply:** any time you add/modify an Express route or middleware and
then test it over HTTP, restart the workflow first.
