---
name: Strict-language rule translates brand names
description: The single-language enforcement injection makes weak LLMs translate/transliterate proper nouns; it must explicitly exempt brand/product/people names.
---

The `[LANGUAGE — ABSOLUTE RULE]` (pipeline.ts) and `[STRICT LANGUAGE RULE]` (session.ts) injections enforce "respond ONLY in <lang> ... including when you encounter an unfamiliar name." Both must also carry a proper-noun EXCEPTION: keep brand/product/company/people names exactly as written, never translate/localize/transliterate them.

**Why:** without the exception, a weak instruction-follower (e.g. sarvam-30b) treats the brand as something to render in the target language. Call 551: the prompt's brand "policyfy / पॉलिसीफाई" came out as **नीतिफाई** — the model translated पॉलिसी (English loanword "policy") into proper Hindi नीति. The "...including when you encounter an unfamiliar name" clause actively primes this. The user's own in-prompt brand-preservation rules are not enough to counter the platform-injected directive.

**How to apply:** any edit to either language-rule string must preserve the proper-noun exception, and the two injections must stay in sync (pipeline emits it twice — top + bottom). This is a prompt-only mitigation; it reduces but does not eliminate misbehavior on genuinely weak LLMs.
