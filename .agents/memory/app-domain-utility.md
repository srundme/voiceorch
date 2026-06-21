---
name: APP_DOMAIN utility
description: How the public-facing domain/URL is resolved across the api-server codebase
---

`lib/app-domain.ts` is the single source of truth for all public-URL derivation. It exports:

- `getAppDomain()` — raw domain string (no protocol), null if unconfigured
- `getSelfBaseUrl()` — full `https://{domain}` or `http://localhost:{PORT}` fallback
- `getAppOrigins()` — all trusted CORS/redirect origins (APP_BASE_URL + APP_DOMAIN + REPLIT_DOMAINS)

**Priority order:** `APP_DOMAIN` → `REPLIT_DOMAINS` (backward compat) → `localhost:{PORT}`

**Local dev (Cursor/.env):** `APP_DOMAIN=localhost:8080`
**Railway production:** set `APP_DOMAIN=<your-railway-domain>.up.railway.app`

`REPLIT_DOMAINS` is intentionally kept as a fallback so existing Railway deployments that already have it set continue working without any Railway env-var changes.

**Why:** The codebase previously had 13 files each reading `process.env["REPLIT_DOMAINS"]` directly. Any new file that needs the self base URL must import from this utility — never read `REPLIT_DOMAINS` or `APP_DOMAIN` directly.

**How to apply:** Any new route/service that needs a self-referencing URL (webhook callbacks, OAuth redirect URIs, whisper URLs) must use `getSelfBaseUrl()` from this utility.
