---
name: VoBiz number→application attach
description: The documented API to link a DID to a VoBiz voice application, and the false-success trap that hid inbound-routing failures
---

# VoBiz number → Voice Application attach

**The rule:** The ONLY documented way to route inbound calls for a DID to webhooks is attaching the number to a VoBiz Application:
`POST /api/v1/Account/{auth_id}/numbers/{number}/application` body `{"application_id": "<app_id>"}` — `{number}` is the **%2B-encoded E.164** (`+` → `%2B`). Detach = `DELETE` same path.

**Why:** Our configure flow historically sprayed ~20 Plivo-style guesses (`Number/{id}/`, `Application/{app}/AttachNumber/`, `partner/numbers/assign`) — none is a real VoBiz endpoint, so purchased numbers stayed "Not linked" and inbound calls died with busy/Error-Reaching-Answer-URL. Worse, the function returned hardcoded `linked:true, verified:true`, which disabled the master-account fallback and made the dashboard report success.

**How to apply:**
- Documented attach FIRST; treat only account-scoped 2xx or a re-list showing `application_id` as verified. Never hardcode success.
- `default_number_app: true` (NOT `default_app`) is the flag that auto-routes newly created app-less numbers; defaults are never retroactive.
- Purchase body is `{e164, currency}` only — an `application_id` passed at purchase time is ignored; always attach after purchase.
- Partner-model reality: partner customer-account numbers endpoints are **read-only** ("assign via Console"); the documented programmatic hand-off is `POST /api/v1/account/{auth_id}/numbers/{%2Be164}/assign-subaccount` `{sub_account_id}` (lowercase `account`), which only applies to true MA→SA sub-accounts. Correct partner flow: transfer balance → purchase **under the customer account's own creds** so the customer owns the DID.
- Official skills live in `.agents/skills/vobiz-*` (13 skills, cloned from vobiz-ai/Agent-Skills) — consult before touching any VoBiz API.
