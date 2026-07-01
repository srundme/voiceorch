---
name: System Prompt Templates — separate store
description: Why there are two prompt-template stores and which one drives live generation
---

There are TWO independent prompt-template stores in the admin portal. The legacy singular-master
store still drives ALL live agent generation and backs the original "Prompt Template" page. A newer
three-layer store (Foundation singleton + dynamic Domains + Client Details singleton, versioning +
single active tracked per-group) backs a SEPARATE new "System Prompt Templates" admin page and is
NOT wired to generation.

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
