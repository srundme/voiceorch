---
name: DPDP compliance is a non-blocking wrapper
description: DPDP Act compliance must never gate dialing; it lives only in pre/post wrapper points, never in the dial/pipeline path
---

DPDP (Digital Personal Data Protection Act 2023) compliance for voice agents is a **non-invasive pre/post wrapper** mirroring TRAI. It must **NEVER** block or gate dialing — there is no pre-dial DPDP check.

**Why:** Blocking dials on compliance breaks live/outbound calling. DPDP is about disclosure + data handling, not call permission. The product requirement is explicit: DPDP never blocks dialing.

**How to apply:**
- DPDP touchpoints are limited to: `services/dpdp/index.ts` (service), `services/dpdpRetention.ts` (daily anonymization job started from `index.ts`), `orchestration/session.ts` (prompt disclosure via `appendDpdpDisclosure` + fire-and-forget post-call `scanAndRedactPII`), `routes/campaigns.ts` (consent-basis validation/insert/launch-check/GET), `routes/admin.ts` (admin-triggered erasure).
- It is gated by the reused `agent_config.compliance.dpdp` boolean — same flag pattern as TRAI.
- **Never** add DPDP references to `orchestration/campaignCaller.ts` or `orchestration/pipeline.ts` (the dial path). Verify with: `rg dpdp` on those files returns nothing.
- Post-call PII scan is fire-and-forget (never awaited in a way that can fail the call).
