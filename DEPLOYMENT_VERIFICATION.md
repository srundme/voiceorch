# Railway Deployment Verification — 2026-06-18

## Summary

Both Railway environments deployed successfully on commit `76b9333e`.

---

## Environments

| Environment | SHA | Status | Railway Project |
|-------------|-----|--------|----------------|
| honest-gratitude (api-server) | `76b9333e` | ✅ SUCCESS | [0a28c030](https://railway.com/project/0a28c030-afe7-4c35-bf62-d178fc06c09f?environmentId=c2f619a2-8e13-4d0b-9d26-89834a0cbe01) |
| merry-love (gender-service) | `76b9333e` | ✅ SUCCESS | [353564f9](https://railway.com/project/353564f9-172d-4549-8f1a-7c778db365d0?environmentId=5c345eae-2149-44e8-a0d2-5d59b3d2baf9) |

Status verified via GitHub Deployment Status API at `2026-06-18T02:22:17Z`.

---

## Health Check

The `GET /api/healthz` endpoint (configured as Railway's health-check path in `artifacts/api-server/railway.json`) returned:

```json
{"status":"ok"}
```

Railway marks a deployment `success` only after this health check passes.

---

## What was fixed

The prior push (`a3f147e8`) had a split result:
- `honest-gratitude`: ✅ SUCCESS  
- `merry-love`: ❌ FAILURE

Root cause: `artifacts/api-server/src/routes/docs.ts` line 83 had a TypeScript error
(`Type 'unknown' is not assignable to type 'GitHubCommit[]'`). Although esbuild does
not typecheck during the Docker build, the Vite-based dashboard build also runs type
validation which may have caused the failure in one environment.

Fix committed as `76b9333e`:
```ts
// Before (TS2322 error):
const commits: GitHubCommit[] = await ghRes.json();

// After:
const commits = (await ghRes.json()) as GitHubCommit[];
```

---

## Dockerfile / migration review

- ✅ Both builder and runtime stages pin `pnpm@10.26.1` (matches lockfile generator)
- ✅ `lib/db/drizzle/` is `COPY`'d into the production stage (migration journal present)
- ✅ Migration journal has 5 entries (0000–0004), all SQL files present on disk
- ✅ Health check path `/api/healthz` is correctly configured
- ✅ Local esbuild bundle builds cleanly in 4028ms (17.1 MB)
