---
name: Webcall flush truncation (tail-word drop)
description: Why the last word(s) of a reply get dropped in webcall.ts — root cause confirmed from DB execution log
---

## The bug
The last word(s) of an LLM reply (e.g. "சார்?") are never sent to TTS and never spoken.

## Confirmed root cause (call-62 execution log evidence)
The Gemini adapter delivers the final streaming token (the tail word + closing tag) **only** to `onComplete`, never to any `onToken` callback. So `tokenBuf` at flush time is a truncated prefix of the last sentence — it ends without terminal punctuation.

The flush block then does:
```
const [, trueRemainder] = extractSentences(cleanForFlush);
flushText = max(trueRemainder, tokenBuf);
```
When the full reply is a single sentence ending in "?" (e.g. wrapped in `<emotion>...</emotion>`):
- `extractSentences(cleanForFlush)` → `sentences=["...full?"], remainder=""`
- `trueRemainder = ""`  → `flushText = tokenBuf = "...truncated"`
- The tail word is permanently lost; no second TTS request is ever made.

## Fix applied (webcall.ts flush block)
Added `tokenBufIsPartial` guard:
```ts
const lastFullSentence = allSentences.at(-1) ?? "";
const tokenBufIsPartial =
  trimmedTB.length > 0 &&
  lastFullSentence.length > trimmedTB.length &&
  lastFullSentence.startsWith(trimmedTB) &&
  !sentenceTexts.includes(lastFullSentence);
const flushText = tokenBufIsPartial ? lastFullSentence : ...;
```
If `tokenBuf` is a proper prefix of the last complete sentence (same start, shorter, not already queued), use the full sentence from `cleanForFlush`.

**Why:** Ensures the complete last sentence is synthesized even when the LLM adapter skips delivering the final chars to `onToken`.

**How to apply:** Any time a Tamil/multilingual agent drops the final word of a reply on the webcall path — check first whether the TTS execution log shows the last TTS request text is missing the final word. If yes, this is the pattern. The fix is in the flush block; pipeline.ts has a separate (mirrored) flush that may need the same treatment.
