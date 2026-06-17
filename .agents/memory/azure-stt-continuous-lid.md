---
name: Azure STT continuous language detection
description: Azure streaming STT locks language at-start by default; speech.context config needed for per-utterance re-detection
---

Azure's WebSocket streaming STT defaults to **at-start language identification**: it detects the language on the first utterance and uses that language for the rest of the session. This means if a caller starts in Tamil, all subsequent Hindi speech is transcribed as Tamil.

**Fix:** Always send a `speech.context` frame with `languageId.mode: "Continuous"` when `candidateLocales.length > 1`:

```json
{
  "phraseDetection": { "mode": "Conversation", ... },
  "languageId": { "mode": "Continuous", "priority": "PrioritizeLatency" }
}
```

**Why:** Without this, Azure's LID "sticks" to the first detected language, breaking mid-call language switching entirely.

**How to apply:** In `azure.ts` `transcribeStream`, send `speech.context` whenever `candidateLocales.length > 1` (even if no keyterms), including the `languageId` block.

**Also needed (pipeline + webcall):** When `currentLang` changes, inject `[ACTIVE LANGUAGE] Respond ONLY in {langName}` into the LLM system prompt. Without this, the LLM may drift back to the agent's primary language even after the STT correctly detects a switch.
