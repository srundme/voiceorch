---
name: Gemini Interactions API — deliberately not adopted
description: Google now recommends a new "Interactions API"/@google/genai SDK for new projects; explains why the voice pipeline's Gemini adapter stayed on the classic generateContent path.
---

Google's current docs steer new projects toward the "Interactions API"
(`@google/genai` SDK, `interactions.create()`, stateful history via
`previous_interaction_id`, step-based SSE with explicit `thought` /
`model_output` / `function_call` steps). The voice-agent Gemini adapter
(legacy `@google/generative-ai`, classic `generateContentStream`/chat) was
evaluated against it and NOT migrated.

**Why:** the classic `generateContent` API remains fully documented and
supported (Google's own docs page has a toggle between the two versions, not
a deprecation notice) — no urgent forcing function to move. The Interactions
API's step/event model is a different integration surface (tool-calling flow,
caching API) with real migration risk on a live low-latency telephony path,
and no demonstrated latency win for a plain conversational turn — if anything
the always-present `thought` step framing is more surface to filter even with
thinking disabled. Also checked: the legacy SDK has zero runtime HTTP
dependencies (uses native `fetch`), so it already gets the benefit of the
process's shared undici keep-alive pool — one common "legacy SDK bypasses our
connection pooling" risk did NOT apply here.

**How to apply:** don't re-litigate this every time Google's docs are pasted
in. Revisit only if Google actually sunsets `generateContent` or the legacy
SDK (check for an explicit deprecation notice, not just a "recommended for
new projects" banner).
