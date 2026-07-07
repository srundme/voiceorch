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

## Multilingual latch — three more traps (fixed — call 1881, "Speak in Tamil")

1. **The latch must drive STT too.** Latching the LLM's output language while the streaming STT stays on its call-start language is self-defeating: the caller's Tamil speech gets transcribed in Devanagari, per-turn script detection reads Hindi, and the agent stays stuck. When a request latches (auto-detect mode), live-switch the streaming STT's language hint (optional `StreamSTT.setLanguage`, Sarvam implements it via silent reconnect with a `switchingLanguage` flag in the close handler — no backoff, no attempt count). Re-apply the latch after any full stream re-init (pipeline reconnect creates a fresh adapter on the call-start language).
2. **Never claim "the caller requested X" from script detection alone.** The strong "caller has explicitly asked for English — ignore your system prompt" OVERRIDE guard was gated on `currentLang === "en-IN"`, so a Latin-script transcript like "Speak in Tamil." triggered a false English override and flipped the agent to English. Strong OVERRIDE guards must be gated on the explicit latch (`requestedLangLatch`), never on detected script; unlatched detection gets only the soft follow-the-caller rule. A latched NON-English request needs the same-strength override (plus colloquial-register + loanword + proper-noun rules) or system prompts that mandate Hindi/Hinglish win.
3. **Persist the explicit request to caller memory as ground truth.** The `language_pref` fact seeds the NEXT call's STT/agent language, so an explicit mid-call request must supersede it directly at call end (before LLM extraction, and blocking extraction from overwriting it that call). Only for languageAutoDetect agents — the strict-mode English escape is this-call-only and must NOT leak into memory or it flips a fixed-language agent's next call. Place-name guard: scrub "Tamil Nadu" before matching or "I live in Tamil Nadu" latches Tamil via the "in <lang>" cue.
