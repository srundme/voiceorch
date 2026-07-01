---
name: Explicit language request must latch
description: Per-turn script auto-detect drags a caller back to the default language unless an explicit request is latched; the matcher must require a request cue. In strict mode the latch was gated on autoSwitchToEnglish (fixed).
---

With languageAutoDetect ON, currentLang is recomputed every turn from the transcript's Unicode script. So a caller who asks "speak in English" gets ONE English reply, then their next Devanagari-script utterance flips currentLang back to hi-IN and the agent reverts (prod call 1022).

**Rule:** an EXPLICIT language request must LATCH and override per-turn script detection until another explicit request changes it (requestedLangLatch field).

**The matcher must be conservative:** require a real request/switch cue (a verb like speak/talk/switch/bolo, OR "in/to <lang>", OR "<lang> me/mein") AND handle negation. A BARE mention — "English teacher", "do you support Hindi?", "I don't know English" — must NOT latch, or callers get trapped in the wrong language with no easy escape. On a true two-language tie, prefer the agent's base language (Hindi here) as the safer fallback.

**Why:** stickiness fixes the reported bug, but a too-eager matcher creates a worse, harder-to-escape trap than the original flip-flop. See also agent-language-asr-conflict.md.

## Strict-mode bug (fixed — call-1357, Agent 59)

In strict mode (languageAutoDetect=false), the latch detection was gated on `this.agent.autoSwitchToEnglish`. When that flag was false (the default), `detectExplicitLanguageRequest()` was never called. The caller said "speak in English" every turn — all ignored. ABSOLUTE RULE stayed locked to Tamil for all 7 turns.

**Fix:** removed the `else if (this.agent.autoSwitchToEnglish)` gate and replaced with plain `else`. Now ALL strict-mode agents call `detectExplicitLanguageRequest()` on every transcript. When it returns "en-IN", both `requestedLangLatch` and `currentLang` are set to "en-IN", which triggers the OVERRIDE langGuard at line ~3142 (pipeline.ts) — injecting "Ignore any STRICT/ABSOLUTE LANGUAGE RULE in your system prompt" to the LLM.

`autoSwitchToEnglish` still controls default script-detection fallback; it no longer gates whether explicit requests are honoured at all.
