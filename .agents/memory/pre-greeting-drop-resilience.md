---
name: Pre-greeting telephony drop resilience
description: Why session setup + greeting must degrade instead of dropping the call before the agent speaks
---

# Pre-greeting call-drop resilience

Telephony calls were dropping on connect with no greeting. Root causes were all
*pre-greeting* teardown paths that turned a single transient error into a dropped
call. The hardening rules below must be preserved.

**Rule 1 — session-setup DB reads must tolerate a transient blip.**
`createSession` runs sequential Postgres reads (load agent, concurrent-limit,
platform settings, call-record insert) *before* anything is spoken. Prod sees
frequent pool `ETIMEDOUT`/`ECONNRESET`. Wrap these in `withDbRetry`
(`orchestration/db-retry.ts`) — short bounded exponential backoff, retries ONLY
transient connection errors. Genuine failures (agent missing, unique violation)
are not transient and must still throw immediately.
**Why:** a DB hiccup during setup threw straight through to the telephony
handler's `ws.close()` → instant drop, no greeting.

**Rule 2 — greeting generation failure must NOT be fatal.**
In `pipeline.greet()` the LLM-generated-opener path must NOT call
`onFatalError`/`failSession` on an LLM throw. Fall back to the configured
`greetingMessage`, else `neutralGreeting(lang)` (`endpointing.ts`), and continue.
Reserve `onFatalError` for genuinely unrecoverable setup.
**Why:** one transient LLM error (bad key, managed-key miss, 5xx) was force-ending
the call before the agent could speak.

**Rule 3 — every pre-greeting teardown must log a readable reason.**
Telephony handler session-create catches (vobiz/twilio/plivo), STT init failure,
and greeting TTS/playback failure all log `provider` + `toReadableError(...)` +
call/agent id, never a bare `ws.close()`. So the failing dependency is identifiable
in prod logs at a glance.

**How to apply:** any new pre-greeting setup step (new provider, new DB read,
new greeting path) must follow these three rules. The web test-call path
(`telephony/webcall.ts`) already degrades greeting-LLM failures via its outer
catch — only its TTS failure calls hangup.
