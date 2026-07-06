---
name: Gemini managed-key seeding gap (fixed)
description: Unlike Groq/Sarvam/Cartesia, GEMINI_API_KEY was never auto-seeded into platform_settings at startup, so updating the secret alone didn't update the managed Gemini key used at call time.
---

`seedManagedKeyFromEnv` in the api-server startup path copies an env-var secret
into its `platform_settings` managed-key row on every boot, but the Gemini
provider was missing from that list — Groq/Sarvam/Cartesia had it, Gemini
didn't. Fixed by adding `seedManagedKeyFromEnv("managed_gemini_key",
"GEMINI_API_KEY")` alongside the others.

**Why:** without this, replacing the `GEMINI_API_KEY` secret would silently do
nothing at runtime — the DB-cached `managed_gemini_key` row would still hold
whatever was seeded (or nothing), and only a manual Admin-panel edit would
actually update the key the pipeline uses.

**How to apply:** when adding a new "managed" provider or investigating why a
secret update isn't taking effect, check the list of `seedManagedKeyFromEnv`
calls at startup — a missing entry there is a common silent gap.

Separately: verify whether a Gemini key is paid-tier by POSTing directly to
`cachedContents.create` (`https://generativelanguage.googleapis.com/v1beta/cachedContents?key=...`)
with a >~1000-token dummy context — a 429 (`limit=0`) means free-tier, a 200
with a `cachedContents/...` name means paid-tier. This is faster than waiting
for a live call to hit the code path, and doesn't require exercising the
pipeline. Delete the test cache entry afterward.
