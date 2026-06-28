---
name: Caller gender salutation detection
description: Why caller Sir/Ma'am salutation silently fails and the invariants that keep it working on web + telephony
---

Caller gender detection (the `{caller_salutation}` → "Sir"/"Ma'am" feature) is fragile in three non-obvious ways. All three must hold or the salutation silently never appears.

**1. Production URL topology.** On Railway the api-server and the Voice Analysis (gender) microservice run in SEPARATE containers. The detectors default to `http://localhost:5000`, which only works in single-VM dev. Prod MUST set `GENDER_SERVICE_URL=http://gender-service.railway.internal:5000` (documented in MIGRATION_RUNBOOK.md / .env.example) or every detection fetch fails and gender resolves null for the whole call.
**Why:** a null gender + a null-branch directive means the agent greets everyone neutrally — looks like a prompt bug but is really env misconfig.
**How to apply:** the startup probe (`orchestration/genderService.ts → probeGenderService`, called from index.ts listen) logs the resolved URL + reachability loudly. Check that log first when salutation is missing in prod. All three detectors resolve the base via the shared `genderServiceBaseUrl()`.

**2. Arming invariant — sample the caller's INTRO, not the greeting.** The detector must only be fed audio AFTER the agent greeting is delivered, so it samples the caller's introduction turn. Audio feed is gated on `genderDetectionArmed`; `armGenderDetection()` is called in greet()'s `finally` (after greeting drained) and in the `firstSpeaker === "user"` early-return branch.
**Why:** feeding pre-greeting / greeting-echo audio pollutes the 2s sample window and the v0 detector auto-fires once at 2s — a bad early sample locks in a wrong/null result.
**How to apply:** this lives in the SHARED pipeline core (createSession/pipeline.ts), so web calls and telephony both inherit it. Never re-implement in webcall.ts.

**3. Gate on placeholder + toggle; directive must be verbatim.** Only instantiate a detector when `genderDetectionEnabled && systemPrompt contains {caller_salutation}` — otherwise we waste gender-service calls for nothing. The per-turn `[CALLER GENDER — MANDATORY]` directive is appended AFTER the language guard (recency) and tells the LLM to keep the salutation EXACTLY as written / as a proper noun that overrides the language rule.
**Why:** see language-rule-proper-nouns — the strict single-language rule transliterates "Sir"/"Ma'am" otherwise; and a soft "when appropriate" directive made weak LLMs drop it entirely.
