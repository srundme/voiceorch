---
name: System Prompt Templates — separate store
description: Why there are two prompt-template stores and which one drives live generation
---

There are TWO independent prompt-template stores in the admin portal. The legacy singular-master
store backs the original "Prompt Template" page. A newer three-layer store (Foundation singleton +
dynamic Domains + Client Details singleton, versioning + single active tracked per-group) backs a
SEPARATE new "System Prompt Templates" admin page.

As of the layered-generation wiring, the dashboard agent "Generate System Prompt" modal now uses the
NEW three-layer store via `GET /wizard/system-prompt-store` (Foundation status + domain dropdown) and
`POST /wizard/generate-system-prompt` (layered compose: Foundation → selected Domain → Client Details
→ form inputs). It HARD-FAILS 422 (`no_foundation` / `no_domain`) with no legacy fallback, runs a
server-side named guardrail pass/fail list (`system-prompt-guardrails.ts`), and persists version
traceability onto `agents.systemPromptGenMeta` (jsonb, migration 0041) on save. The legacy
`prompt_templates` page and its own generation path are still untouched.

**Why:** the user gave an explicit mid-task instruction — "Do not replace 'prompt template', add a
new section called 'system prompt templates'." This reversed the original task spec, which had said
to REPLACE the page. So the two stores/pages coexist by deliberate user choice; the legacy page,
its "no active template" banner, and the generation flow must stay untouched. (A code review that
grades against the original spec will wrongly flag this as "should have replaced the nav / updated
the banner" — the user's instruction takes precedence.)

**How to apply:** the follow-up that composes Foundation + selected Domain + Client Details into the
final generation call is what switches generation onto the new store. Until then, editing the new
store has zero effect on real agents. Do NOT "consolidate" the two pages/nav items back together
unless the user asks — that would undo their explicit request.
