---
name: Azure Speaker Recognition key requirement
description: Voice prints fail silently with HTTP 401 when using a single-service Azure Speech key; requires multi-service Cognitive Services key
---

## Rule

The `managed_azure_speech_key` in `platform_settings` must be a **multi-service Azure Cognitive Services** key, not a single-service Azure Speech Services key.

**Why:** The Speaker Recognition API (`/speaker/identification/v2.0/text-independent`) is a separate Azure service from Azure Speech (STT/TTS). A key scoped to "Speech Services" only returns HTTP 401 on the Speaker Recognition endpoint, even if the region is correct. Azure's multi-service Cognitive Services key covers both.

**How to apply:**
- If voice prints show 0 enrollments despite completed calls, suspect a key type mismatch first.
- Use `GET /api/admin/azure-speaker-check` (admin token required) to get a live pass/fail with the actual HTTP status and error body.
- In the Admin panel: Managed Keys → STT section → "Test Speaker Recognition" button.
- The server startup probe also logs `Azure Speaker Recognition: connectivity FAILED` at WARN level if the key is wrong.
- Fix: replace `managed_azure_speech_key` with a key from an Azure "Cognitive Services (multi-service)" resource, not "Speech Services".
