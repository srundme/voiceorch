---
name: BYO Plivo numbers
description: How user-owned Plivo numbers become first-class phone_numbers rows and how inbound routing works
---
- `phone_numbers.provider` column ('vobiz' default | 'plivo'): BYO rows are free (rates 0, no nextRenewalAt) and skipped by VoBiz unrent on release.
- `services/byo-numbers.ts` syncByoPlivoNumbers(userId,{configureAll}) is the single entry: called from providers POST/PATCH/DELETE and assign (configureAll=true → touches Plivo API) and GET /phone-numbers backfill (DB-only unless a row changes). Never converts an existing non-plivo row (revenue leak) and never steals another user's number.
- Plivo-side auto-config: find-or-create Application "SnapServe Inbound" (answer_url = /api/webhooks/plivo/voice, no agentId) + attach number; all best-effort, never fatal.
- Inbound: /webhooks/plivo/voice resolves agent by To-number lookup when agentId param absent (canonicalize candidates + last-10 fallback). **Suffix fallback only when NO exact row exists** — an exact-but-unassigned match must return "not assigned", or calls can misroute cross-tenant. Signature validation works because agentId is resolved before getAgentProviderToken.
- Assign route gates: provider='plivo' → re-sync Plivo config; else VoBiz webhook link. Dashboard hides Release + FixInbound for plivo rows; row disappears when the Plivo key is deleted.
