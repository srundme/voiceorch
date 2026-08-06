---
name: Managed client mode enforcement
description: Rules for partner acting-as-client (x-client-context) and managed-client write blocks
---
- Acting-as only works on routes that mount the `clientContext` middleware; the header is silently ignored elsewhere (request runs as the partner). Covered families (as of partner control-panel fix): agents, calls, wallet, analytics, campaigns (+ batches/dashboard/ops/leads/…), connections, CRM, Meta, sheet-auto-calls, account, providers, squads, disposition, email, webhook-endpoints, phone-numbers (incl. purchase/assign), scheduling. Any new client-facing route family still needs it added deliberately.
- `denyManagedClient` write-blocks must be audited per-route — coverage is opt-in. A review pass found gaps on configure-webhook, routing-rules, sync-vobiz-partner, caller-memory deletes after the first sweep.
- **Self-partner guard:** every "is managed client" check (denyManagedClient, /partner/context isManagedClient) must exclude users whose linked partner org is their OWN (partners.userId === clerkId), or self-partners lock themselves out of their own workspace.
- Frontend acting-as state is sessionStorage-backed (dashboard lib/acting-as.ts) because the agent builder navigates across routes/reloads; `queryClient.clear()` is mandatory on enter AND exit — the react-query cache does not key on the header.
- Raw `fetch()` calls in the dashboard bypass the acting-as header; anything account-scoped must go through the shared `customFetch`.
- Webcall testing of a client agent bills the CLIENT (agent owner), mirroring share-link guests.
- **Why:** partner builds/operates agents inside client accounts; server-side enforcement is the boundary, UI trimming is UX only.
- **How to apply:** adding routes that mutate client-visible resources → add `clientContext` (if acting-as should work) + `denyManagedClient`; adding dashboard surfaces → check `partnerCtx.isManagedClient` and the layout route-guard allowlist.
