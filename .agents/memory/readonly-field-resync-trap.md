---
name: Read-only form fields must be dropped from PATCH payloads
description: A form field made read-only in the UI but still round-tripped through PATCH re-triggers server-side "if field present" sync logic with stale data on every unrelated save
---

When a field in a shared edit form is turned read-only/display-only (ownership moved to another page/flow), it is not enough to remove its `onChange` — it must also be stripped from the update payload builder (e.g. destructured out before the `...rest` spread), or its stale load-time value gets resubmitted on every unrelated save.

**Why:** VoiceOrch's agent Inbound/Outbound phone number fields were made read-only in `builder.tsx` (assignment moved to the Phone Numbers page), but `buildUpdateAgentPayload` still forwarded `inboundPhoneNumberId`/`outboundPhoneNumberId` from form state on every save. The PATCH `/agents/:id` handler treats `"inboundPhoneNumberId" in parsed.data` as "assignment changed" and re-runs its ownership-sync (clear old owner → assign new owner). Since the value was just the stale value from page load, saving an agent for an unrelated reason (rename, prompt edit, etc.) would silently reassign the phone number back to whichever value was cached in the form — appearing to "steal" it from whoever the Phone Numbers page had since assigned it to.

**How to apply:** Whenever a field moves from editable to read-only/derived-display within a shared form: (1) also read display values by deriving from the live source of truth (e.g. `list.find(x => x.ownerId === thisRecord.id)`) instead of trusting the record's own possibly-stale FK column, and (2) exclude the field entirely from the payload sent on save. On the server, prefer keying "did this actually change" sync logic off an explicit action/endpoint rather than mere key-presence in a general-purpose PATCH body.

**Merge-endpoint clear-field variant:** the agents update route MERGES agentConfig, so a form that omits a key when the field is blanked can never clear it — the old value persists forever ("leave blank for default" lies). Fix: always send the key with explicit null; server-side resolution must treat present-but-null as "reset to default" and consult any LEGACY key only when the new key is absent (`null ?? legacy` silently resurrects the stale cap).
