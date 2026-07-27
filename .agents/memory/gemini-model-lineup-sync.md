---
name: Gemini model lineup sync
description: Where Gemini model choices live and how they drift; current lineup as of July 2026
---

**Rule:** any Gemini model-lineup change must touch ALL surfaces in the same pass, and every raw-REST call site must build its thinking config via the shared `geminiThinkingConfig()` export from the google LLM adapter — never hardcode `thinkingBudget`/`thinkingLevel` at a call site (the fields are generation-specific and mutually incompatible).

**Why:** July 2026 audit (against Google's official gemini-skills + models docs) found the surfaces had drifted independently: dashboard offered only 2.5-gen models, and the admin family pages still offered gemini-2.0-flash/-lite and gemini-1.5-pro — all shut down server-side, so selecting them produced broken agents. Two route files also hardcoded 2.x-only `thinkingBudget:0`, which hard-errors on any 3.x model.

**Surfaces to keep in sync:**
- dashboard `agent-providers.ts` (list order defines `defaultGeminiModel()`; `DEFAULT_TAMIL_LLM_MODEL` separate) + builder quick-create hardcode
- admin family `agent-new.tsx` + `agent-detail.tsx` model lists
- admin `managed-keys.tsx` description copy
- api-server internal defaults: google LLM adapter, gemini STT adapter, disposition-llm (OpenAI-compat endpoint — model string only, no thinkingConfig), kb-pdf-extract, squad-engine planner, vibe + workflows builders

**How to apply:** keep previous-gen options users may have stored (label "Previous Gen") so edit-form Selects don't blank; NEVER keep shut-down generations. Lineup July 2026: 3.6-flash (balanced default), 3.5-flash-lite (fastest), 3.5-flash; 2.5-flash/-lite previous-gen but served; 2.0-x/1.5-x DEAD. Dev env has no Gemini key (no managed key, no provider rows) — model bumps get first real verification on a prod test call.
