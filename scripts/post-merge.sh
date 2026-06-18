#!/bin/bash
set -e

pnpm install --no-frozen-lockfile
pnpm --filter @workspace/db run push-force

# ── Sync to GitHub (Railway deploys from there) ──────────────────────────────
# Uses the GitHub Git Data API instead of `git push` — HTTPS PAT-based push
# is intercepted by Replit's credential helper and cannot be made to work.
GITHUB_TOKEN="${GITHUB_PERSONAL_ACCESS_TOKEN:-${GITHUB_PAT:-}}"
if [ -z "${GITHUB_TOKEN}" ]; then
  echo "WARNING: GITHUB_PERSONAL_ACCESS_TOKEN is not set — skipping GitHub sync. Railway will not redeploy." >&2
else
  pnpm --filter @workspace/scripts run sync-to-github
fi
