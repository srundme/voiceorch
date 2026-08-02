---
name: Compact greeting prompt hallucination
description: Why the LLM opener can invent a fictional company and how extraction is hardened
---
- The greeting-only LLM call uses `buildCompactGreetingPrompt` (pipeline.ts), NOT the full system prompt — it clips CALLER MEMORY + IDENTITY + CALL FLOW via regex for speed.
- **Why:** the original clips required a `===`/`---`/`[` boundary near the section; prompts with plain-text headings matched NOTHING, so the greeting LLM got zero identity and hallucinated a plausible company ("Pixel Solutions", call 5198) while all later turns (full prompt) were correct.
- Second failure mode (call 5246): memory facts loaded fine but the opener restarted fresh — the 800-char IDENTITY clip truncated tail rules ("hello already spoken", one-sentence opener) and nothing told the greeting LLM to use the memory. Cap now 1600 + a `[RETURNING CALLER]` rule appended whenever a memory block is present.
- Third failure (call 5250): even with correct clips, the compact context let Gemini translate "Fortune Trade Fairs" into an astrologer persona. Final design: prompts ≤12k chars (GREETING_FULL_PROMPT_MAX_CHARS) greet from the FULL system prompt + opening rules; clipping survives only for very large prompts (huge baked KB).
- **How to apply:** any change to greeting extraction must keep three layers: terminator-anchored clip → greedy hard-capped clip → top-1500-chars-of-body fallback, plus the `[NEVER INVENT]` rule appended to every greeting prompt. Symptom signature: wrong company ONLY in the opener, tiny `promptChars` in the greeting exec-log entry vs the full Prompt Generated length.
