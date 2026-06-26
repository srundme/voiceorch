# Threat Model

## Project Overview

VoiceOrch is a multi-tenant SaaS for building and operating AI voice agents. It uses a React dashboard and an Express API server backed by PostgreSQL, and integrates with third-party telephony, LLM, STT, TTS, Google OAuth, Gmail, and webhook endpoints. The production deployment is a public Replit VM deployment, so every `/api` route that is not server-side authenticated or provider-signed should be treated as internet reachable.

Production scope for this scan excludes development-only previews, local-only tooling, and mockup/sandbox paths unless code shows they are reachable from the deployed API. TLS is provided by the platform. `NODE_ENV` can be assumed to be `production` in deployed environments.

## Assets

- **User accounts and sessions** — platform-issued session JWTs, Google identities, admin impersonation exchange codes, and admin bearer-equivalent tokens. Compromise allows tenant or administrator impersonation.
- **Tenant voice infrastructure** — telephony provider credentials, outbound phone numbers, call controls, call recordings, transcripts, summaries, and scheduling calendars. Abuse causes direct financial loss, data leakage, and unauthorized customer contact.
- **Third-party API secrets** — BYOP provider keys, managed platform keys, Google Calendar refresh tokens, Gmail credentials, webhook secrets, and platform admin tokens. These enable actions outside the application boundary.
- **Scheduling data** — attendee names, emails, notes, slot selections, Meet links, and Google Calendar connections. This is customer PII plus business-sensitive meeting metadata.
- **Billing and usage data** — wallet balances, free credits, usage events, cost calculations, and platform analytics. Tampering can create fraud or conceal abuse.

## Trust Boundaries

- **Browser / public caller to API** — all dashboard traffic, public booking flows, telephony/webhook callbacks, and any unauthenticated endpoints cross this boundary. The client and caller are untrusted.
- **Authenticated tenant to tenant-owned resources** — any route that reads or mutates agents, calls, bookings, providers, phone numbers, or campaigns must enforce tenant ownership server-side.
- **Admin to tenant boundary** — `/api/admin*` uses separate `x-admin-token` authentication and impersonation features. Any mix-up here becomes full tenant compromise.
- **API to PostgreSQL** — the API can read and mutate secrets, billing state, and call records. Injection or missing authorization at this layer has high impact.
- **API to third-party providers** — the server calls telephony vendors, Google OAuth/Calendar, LLM/TTS/STT APIs, email providers, and user-configured webhook targets. Outbound requests must not let untrusted users pivot the server into sensitive actions.
- **Public webhook/provider boundary** — Twilio, Plivo, VoBiz, Meta, Google OAuth, and scheduling public flows send requests into the API. These requests must be authenticated by signature, nonce/state binding, or capability tokens.

## Scan Anchors

- Production API entry point: `artifacts/api-server/src/app.ts` and `artifacts/api-server/src/routes/index.ts`
- Auth/session boundary: `artifacts/api-server/src/lib/session.ts`, `artifacts/api-server/src/middlewares/session.ts`, `artifacts/api-server/src/middlewares/requireAuth.ts`, `artifacts/api-server/src/middlewares/requireAdmin.ts`
- Highest-risk route areas: `artifacts/api-server/src/routes/calls.ts`, `artifacts/api-server/src/routes/webhooks.ts`, `artifacts/api-server/src/routes/scheduling/public.ts`, `artifacts/api-server/src/routes/scheduling/google-oauth.ts`, `artifacts/api-server/src/routes/admin-user-mgmt.ts`
- Public surfaces: `/api/auth/*`, `/api/webhooks/*`, `/api/campaign-webhook*`, `/api/scheduling/public/*`, booking token flows, some call-control endpoints in `routes/calls.ts`
- Admin-only surfaces: `/api/admin*`, admin voice/config/deployment routes, impersonation session creation
- Usually ignore unless proven reachable: test helpers, dev previews, generated clients/schemas, dashboard-only code paths without corresponding server exposure

## Threat Categories

### Spoofing

VoiceOrch accepts both user session tokens and third-party callbacks, so identity binding is central. Protected tenant routes must require a valid platform session, admin routes must require the separate admin token, and external callback routes must validate provider signatures or equivalent proof. OAuth callback flows must bind `state` to the initiating user agent or a server-side nonce store so one user cannot attach an external account to another tenant.

### Tampering

The API exposes call lifecycle, scheduling, campaign, wallet, and provider-management functionality. Any route that mutates calls, bookings, campaign state, or provider-linked resources must enforce tenant ownership and reject unauthenticated callers. Client-supplied identifiers such as `agentId`, `callId`, booking tokens, and callback IDs must never be sufficient on their own to authorize a state change.

### Information Disclosure

The system stores call recordings, transcripts, provider secrets, Google Calendar tokens, attendee PII, and operational analytics. Recording download routes, call detail endpoints, booking token flows, and webhook payloads must scope data to the correct tenant or capability token and must not leak secrets or sensitive metadata in logs or responses. Public booking and webhook endpoints should reveal only the minimum information needed to complete the flow.

### Denial of Service

Public scheduling, webhook, telephony, and any unauthenticated call-control route can be reached directly from the internet. These surfaces need rate limits, bounded request sizes, and cheap rejection paths so attackers cannot force excessive provider calls, expensive downstream API usage, or excessive database churn. External requests must use timeouts so third-party latency does not exhaust worker capacity.

### Elevation of Privilege

The biggest privilege risks are broken tenant isolation, missing auth on call-control endpoints, and admin/impersonation boundary mistakes. Tenants must not be able to initiate calls, modify call records, attach third-party accounts, or influence billing for other tenants. Admin impersonation exchange codes must remain single-use and short-lived, and any privileged route must enforce server-side authorization independently of the frontend.