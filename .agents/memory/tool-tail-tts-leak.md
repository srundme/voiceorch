---
name: Tool-call tail leaks to TTS
description: Why a start-anchored envelope guard misses tool markup appended AFTER conversational text, and the two-layer defense
---
The streaming tool-envelope guard only inspects the FIRST non-whitespace char of a reply, and the function-tag filter only strips `<function=…>`. So when a weak LLM (e.g. sarvam-30b) emits a normal sentence and THEN appends a bare tool tail like `<arg_value>{ "scheduled_at": null }` (no `<function=`, no proper close), it slips past both and gets SPOKEN by TTS (prod call 1022).

**Rule:** leaked tool markup needs a mid/end-of-stream defense, not just a start-of-reply guard.
- Streaming: a per-turn kill-switch (makeToolTailFilter) that, once it sees ANY tool marker (`<function`, `<arg_value`, `<arg_key`, `<tool_call`, `<tools>`, `<|tool`, `<|python_tag|>`), emits text before it and suppresses everything after for the rest of the turn. Hold back only a marker-prefix tail for chunk-split safety; match case-insensitively.
- Whole-string: stripToolArtifacts() on the cleanResponse final-flush/history path removes well-formed blocks AND any dangling tool tag through end-of-string, so the tail never reaches the final flush or conversation history.
- Wire the streaming filter into ALL token chains (main + fallback + chained-tool turn) at BOTH filter-setup sites, or one path still leaks.

**Why:** envelopeGuard is start-anchored by design; a post-text tail is a different failure mode. A malformed/unnamed tail can't be reliably executed as the intended tool, so dropping it silently beats speaking it.
