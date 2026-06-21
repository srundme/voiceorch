---
name: Agent language vs ASR language conflict
description: session.ts language rule must prefer asrLanguage over language to avoid injecting an "English only" override for Tamil-configured agents.
---

The rule: in `session.ts`, always use `agent.asrLanguage ?? agent.language` (not just `agent.language`) when building the `[STRICT LANGUAGE RULE]` injection.

**Why:** `agent.language` defaults to `"en-US"` for every new agent in the form. When a user configures Tamil by setting only `asrLanguage = "ta-IN"` (the ASR tab), `agent.language` is still `"en-US"`. Before this fix, the pipeline injected "You MUST respond ONLY in English" — actively overriding the Tamil instruction in the system prompt. The ASR language reflects what the caller actually speaks; it should take priority.

**How to apply:** Any future language-enforcement logic in `session.ts` or `pipeline.ts` must resolve: `const agentLang = agent.asrLanguage ?? agent.language`. The webcall path (`webcall.ts`) already did this correctly via `currentLangWc = agentLanguage ?? ""` at line 425.
