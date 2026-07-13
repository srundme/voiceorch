#!/usr/bin/env bash
# Local SnapServe dev — API + built dashboard on http://localhost:8080
#
# Prereqs:
#   1. Copy .env.example → .env and set DATABASE_URL (Railway Postgres public URL)
#   2. pnpm install (from repo root)
#
# Usage: ./scripts/dev-local.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export PORT="${PORT:-8080}"
export NODE_ENV="${NODE_ENV:-development}"
export APP_DOMAIN="${APP_DOMAIN:-localhost:8080}"
export FRONTEND_DIST_PATH="${FRONTEND_DIST_PATH:-artifacts/dashboard/dist/public}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set."
  echo "Create .env from .env.example and paste your Railway Postgres URL."
  echo "Railway → Postgres service → Variables → DATABASE_URL (or DATABASE_PUBLIC_URL)"
  exit 1
fi

if [[ -z "${SESSION_SECRET:-}" ]]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
  export SESSION_SECRET
  echo "Using generated SESSION_SECRET for this session (add to .env to persist)"
fi

echo "Building dashboard..."
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/dashboard run build

echo "Starting API on http://localhost:${PORT} ..."
pnpm --filter @workspace/api-server run dev
