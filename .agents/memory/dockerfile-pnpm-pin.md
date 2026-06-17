---
name: Dockerfile pnpm version pinning
description: Must pin exact pnpm version in Dockerfile to match the version that generated pnpm-lock.yaml
---

## Rule
Always pin the exact pnpm version in BOTH stages of the Dockerfile:
```dockerfile
RUN npm install -g pnpm@10.26.1   # NOT pnpm@10 (gets latest, breaks frozen-lockfile)
```

Both the builder stage (line ~5) and runtime stage (line ~33) must use the same exact version.

**Why:** `npm install -g pnpm@10` installs the LATEST 10.x release. Railway Docker builds cache the `npm install -g pnpm@10` layer, so a new Railway deploy may suddenly get pnpm@10.34.x while the lockfile was generated with pnpm@10.26.1. The 8-minor-version gap introduced stricter `--frozen-lockfile` validation that fails. The lockfile format is sensitive to the pnpm minor version that generated it.

**Symptom:** Railway build fails in ~40 seconds with a frozen-lockfile error after a Docker layer cache invalidation (e.g., after pushing any file that appears before the `RUN pnpm install` step). Deployments that don't invalidate the cache still succeed (misleadingly looks like the error is intermittent).

**How to apply:** Whenever you bump pnpm (update `packageManager` in root `package.json`), also update BOTH `pnpm@X.Y.Z` lines in `artifacts/api-server/Dockerfile` to match.
