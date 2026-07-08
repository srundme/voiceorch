---
name: Gemini JSON-mode MAX_TOKENS truncation
description: Structured-output Gemini calls die silently at the token cap; check finishReason and retry adaptively, never identically
---

When calling Gemini `generateContent` with `responseMimeType: "application/json"`, a response that hits `maxOutputTokens` is cut mid-JSON and is unparseable. Verified live: `finishReason: "MAX_TOKENS"` on the candidate, with the truncated text still in `parts`.

**Why:** Retrying the identical request is doomed — the same prompt produces the same over-long output and the same truncation, so 3 retries = 3 identical failures ending in a generic "AI unavailable" error.

**How to apply:**
- Set `maxOutputTokens` generously for full-config/whole-document outputs (2048 is far too small when the model must echo a complete config every turn).
- Always read `candidates[0].finishReason`; treat `MAX_TOKENS` + parse failure as a distinct "malformed" class, not "unavailable".
- On truncation/parse failure, retry with an appended recovery user message ("respond with ONLY the complete compact valid JSON…") instead of an identical repeat.
- Log httpStatus, finishReason, attempt, and a capped raw-response snippet on every failed attempt, or the next occurrence is undiagnosable after log rotation.
- Classify errors (malformed vs unavailable) so the user-facing message says whether retrying will help.
