---
name: WhatsApp BYON OTP capture
description: Design constraints for the armed OTP-capture intercept that WhatsApp-enables voice DIDs
---

BYON lets users WhatsApp-enable an existing voice DID (numberSource='voice_number', keeps service='voice'). Verification robocalls land on the DID itself (which normally routes to the AI agent), so an "armed capture" flow answers them with `<Record>` + transcription and surfaces the spoken code.

Non-negotiable design rules (architect-review findings):

1. **Intercept only status='armed'.** The voice answer webhook checks BYON rows before the phone-number lookup; matching `code_captured` too keeps hijacking REAL inbound calls for the rest of the 15-min window. Capture success (transcription sets `code_captured`) must naturally disarm. Re-arm is explicit via the dashboard.
2. **SSRF guard on recording URLs.** The recording callback is public (capability = unguessable vid) and stores a URL that the authed recording proxy later fetches server-side — an owner-forgeable SSRF primitive. Store/fetch only https URLs on allowlisted media host suffixes (env `VOBIZ_MEDIA_HOSTS`, default .vobiz.com/.vobiz.in/.plivo.com/.amazonaws.com), no IP literals, and re-validate every redirect hop (fetch with redirect:"manual", max ~3 hops).
3. **Never downgrade confirmed rows.** Both OTP callbacks must scope their UPDATE to status IN ('armed','code_captured') so late/forged callbacks can't overwrite a confirmed verification.

Also: OTP extraction runs digits-first then spelled-word pass; VoBiz-initiated verifications (vobizVerificationId set) auto-confirm via the bring-your-own/confirm API; releasing ANY number (voice or whatsapp service) must deactivate channels bound to it since BYON means voice DIDs can back channels.
