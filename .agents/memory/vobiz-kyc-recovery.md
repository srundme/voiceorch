---
name: VoBiz KYC account recovery
description: How to recover a VoBiz sub-account auth_id when it exists on VoBiz but not in our DB
---

## Rule

VoBiz has no `GET /partner/accounts` endpoint. Recovery must use `GET /api/v1/partner/kyc-sessions` (paginated list), which returns `account_auth_id` per session. Match by `customer_email` (email-flow sessions) or `metadata.email` (redirect-flow sessions, when we stored it).

**Why:** Tried `GET /accounts`, `GET /accounts?email=…` — all 4xx. Confirmed by official VoBiz docs: only `POST /accounts` exists for the partner accounts API. The KYC sessions list endpoint is the only way to look up an existing sub-account by email.

**How to apply:**
- `fetchVobizSubAccountByEmail` in `artifacts/api-server/src/routes/kyc.ts` now paginates through `GET /api/v1/partner/kyc-sessions` and matches on `customer_email` or `metadata.email`.
- Every new `createVobizKycSession` call includes `metadata: { email: userEmail }` so recovery always works going forward.
- Auth: all partner API calls use `X-Auth-ID` + `X-Auth-Token` headers only (not Bearer token, despite Postman collection showing Bearer).
- `auth_id` is also passed back to the redirect callback URL as a query param (`?session_id=…&status=…&auth_id=…`).
- For stale redirect-flow sessions created before this fix (no `metadata.email`), recovery will fail — those accounts need manual DB insertion.
