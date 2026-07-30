---
name: Plivo/Twilio webhook signature URL reconstruction
description: Why BYO-Plivo calls 403'd in prod and the rules for provider signature URL building
---

**Rule:** Plivo v2 signature = base64(HMAC-SHA256(auth_token, full_base_url_without_query + nonce)) — URL first, nonce second, and the URL must be the full public URL (scheme://host/path). Twilio signs full URL *with* query + sorted body params.

**Why:** BYO-Plivo outbound calls dialed but died instantly in prod: validation hashed `nonce + req.path` (wrong order, path-only). Additionally the webhooks router is mounted at `/api`, so `req.path` drops the `/api` prefix — any provider-signature URL rebuild must use `req.originalUrl`, and forwarded headers (`x-forwarded-proto/host`) must take only the FIRST comma value (multi-hop proxies send "https,http").

**How to apply:** Use the shared `signedRequestUrl()` helper in routes/webhooks.ts for any new provider signature check; never `req.path` or raw forwarded headers.

**Open gap (from review):** `/webhooks/plivo/recording` and `/webhooks/plivo/amd` are still unauthenticated (spoofable persistence); campaign-status has its own APP_SECRET HMAC.
