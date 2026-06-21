---
name: Webcall flush truncation (tail-word drop)
description: Why the last word(s) of a reply get dropped in webcall.ts — root cause + fix evolution
---

## The bug
The last word(s) of an LLM reply (e.g. "சார்?") are never sent to TTS and never spoken — seen intermittently ("some dialogues complete, some drop last word").

## Root causes

**Case A — exact-prefix miss (Gemini adapter):**
The Gemini adapter delivers the final streaming token (the tail word + closing tag) **only** to `onComplete`, never to any `onToken` callback. So `tokenBuf` at flush time is a truncated prefix of the last sentence — it ends without terminal punctuation.

**Case B — near-prefix miss (incremental filter drift):**
Even when the LLM adapter delivers all tokens, the incremental `filterMarkupToken` transforms (e.g. space normalization around `<break>` or `<emotion>` tags, streaming state machine) can produce slightly different whitespace/characters than the single-pass regex stripping in `cleanForFlush`. A strict `startsWith(trimmedTB)` fails on these near-prefixes, falls back to the truncated `tokenBuf`, and drops the final word.

## Current fix (webcall.ts flush block)
Replaced the strict `startsWith` guard with a length+queue check (`useLastFullSentence`):
```ts
const useLastFullSentence =
  trimmedTB.length > 0 &&               // tokenBuf has content to flush
  lastFullSentence.length >= trimmedTB.length &&  // full sentence is at least as long
  !sentenceTexts.includes(lastFullSentence);      // not already queued this turn
const flushText = useLastFullSentence
  ? lastFullSentence
  : (trueRemainder.trim().length > trimmedTB.length ? trueRemainder : tokenBuf);
```

**Why:** Prefers the complete sentence from `cleanForFlush` (derived from the full reply set by `onComplete` — always correct) whenever tokenBuf has something to flush and the full sentence isn't already queued. No `startsWith` dependency means filter-transform whitespace differences don't cause misses.

**How to apply:** Any time a Tamil/multilingual agent drops the final word of a reply on the webcall path. Check TTS execution log — if the last TTS request text is missing the final word, this is the pattern. pipeline.ts has a separate (mirrored) flush that may need the same treatment.
