---
name: Explicit language request must latch
description: Per-turn script auto-detect drags a caller back to the default language unless an explicit request is latched; the matcher must require a request cue
---
With languageAutoDetect ON, currentLang is recomputed every turn from the transcript's Unicode script. So a caller who asks "speak in English" gets ONE English reply, then their next Devanagari-script utterance flips currentLang back to hi-IN and the agent reverts (prod call 1022).

**Rule:** an EXPLICIT language request must LATCH and override per-turn script detection until another explicit request changes it (requestedLangLatch field).

**The matcher must be conservative:** require a real request/switch cue (a verb like speak/talk/switch/bolo, OR "in/to <lang>", OR "<lang> me/mein") AND handle negation. A BARE mention — "English teacher", "do you support Hindi?", "I don't know English" — must NOT latch, or callers get trapped in the wrong language with no easy escape. On a true two-language tie, prefer the agent's base language (Hindi here) as the safer fallback.

**Why:** stickiness fixes the reported bug, but a too-eager matcher creates a worse, harder-to-escape trap than the original flip-flop. See also agent-language-asr-conflict.md.
