---
name: Managed plan post-call memory
description: Post-call updateCallerProfile silently skips on managed plan — must fall back to platform managed key.
---

`endSession` in `session.ts` queries `providersTable` for the user's BYOP LLM key to run `updateCallerProfile` after each call. Managed-plan users have no entry in `providersTable` → `memLlmKey` is null → the update is silently skipped → caller memory never persists.

**Fix applied:** After the BYOP key query returns null, fall back:
1. Look up the platform managed key from `platform_settings` using the same `MANAGED_LLM` map (`qwen/groq → managed_qwen_key`, `openai → managed_openai_key`, etc.)
2. Final fallback: `process.env["GROQ_API_KEY"]`

**Why:** Memory loading at call start was already correct (session.ts had that right). The gap was only in the post-call write path.

**How to apply:** Any future post-call LLM call (summary, eval, memory) that fetches a key from `providersTable` must include the same managed key fallback or it will silently no-op for managed-plan users.
