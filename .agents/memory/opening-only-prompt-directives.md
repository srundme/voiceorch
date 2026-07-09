---
name: Opening-only prompt directives must be one-shot
description: Any "open the call by X" directive injected into the persistent system prompt double-delivers unless neutralized after the opener is spoken.
---

**Rule:** Directives phrased as opening instructions (greet by name, reference prior memory, acknowledge a dropped call) must not remain in force after the opener exists in conversation history. The pipeline appends a one-shot `[OPENING ALREADY DELIVERED]` note in the volatile per-turn prompt tail, gated on (a) an assistant turn existing in history and (b) marker strings from the injected directives being present in the base prompt.

**Why:** The compact greeting LLM already delivers the opening; the main LLM's turn-1 generation otherwise sees the same "open by…" directive and re-delivers the recognition/drop-apology a second time.

**How to apply:**
- Adding any NEW opening-phrased directive to the injected system prompt (callerMemory / session resume blocks)? Add its marker to the `hasOpeningOnlyDirective` check in pipeline.ts's processTurn, or it will double-deliver.
- The check matches literal marker strings ("THIS IS A RETURNING CALLER", "RESUME, DO NOT RESTART", "=== RESUME DIRECTIVE ==="). Rewording those directive texts silently breaks the neutralizer.
- The note lives in the volatile tail: appended AFTER the staged-prompt rebuild and AFTER cacheBaseForTurn capture (Gemini cache invariant), BEFORE the per-minute date/time block (its text is constant → stable prompt-cache prefix).
- Persistent rules (NAME PRIORITY, DO NOT RE-ASK KNOWN INFORMATION) must stay in force all call — never neutralize those.
