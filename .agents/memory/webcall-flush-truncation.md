---
name: Webcall flush truncation (tail-word drop)
description: Why the last word(s) of a reply get dropped — root cause + fix evolution, applies to both webcall.ts and pipeline.ts
---

## The bug
The last word(s) of an LLM reply (e.g. "சார்?", "லாமா?") are never sent to TTS and never spoken — seen intermittently ("some dialogues complete, some drop last word").

## Root causes

**Case A — exact-prefix miss (Gemini adapter):**
The Gemini adapter delivers the final streaming token (the tail word + closing tag) **only** to `onComplete`, never to any `onToken` callback. So `pendingText`/`tokenBuf` at flush time is a truncated prefix of the last sentence — it ends without terminal punctuation.

**Case B — near-prefix miss (incremental filter drift):**
Even when the LLM adapter delivers all tokens, the incremental `filterMarkupToken` transforms can produce slightly different whitespace/characters than the single-pass regex stripping in `cleanForFlush`. A strict `startsWith` fails on near-prefixes, falls back to the truncated buffer, and drops the final word.

**Case C — sentence-boundary edge case (pipeline.ts, both flush sites):**
When the last sentence ends with a sentence-boundary character (e.g. "?"), `extractSentences(cleanResponse)` returns `remainder=""` — the full sentence was already captured in `sentences[]`. The old fix (`trueRemainder.length > pendingText.length`) worked when remainder was non-empty, but fell through to the truncated `pendingText` (= "பார்க்க") when remainder was empty — dropping "லாமா?" even though `cleanResponse` had it. Fix: when `trueRemainder` is empty and `pendingText` is a strict prefix of `allSentences.at(-1)`, enqueue the full last sentence.

## Current fix (pipeline.ts — both processTurn and continueWithToolResult flush sites)
```ts
const { sentences: allSentences, remainder: trueRemainder } = extractSentences(cleanResponse);
const pendingTrim = pendingText.trim();
let flushText: string;
if (trueRemainder.trim().length > pendingTrim.length) {
  flushText = trueRemainder;
} else if (pendingTrim) {
  const lastSentence = (allSentences.at(-1) ?? "").trim();
  flushText = (lastSentence.startsWith(pendingTrim) && lastSentence.length > pendingTrim.length)
    ? lastSentence
    : pendingText;
} else {
  flushText = pendingText;
}
if (flushText.trim()) enqueue(flushText);
```

## Current fix (webcall.ts flush block)
Replaced the strict `startsWith` guard with a length+queue check (`useLastFullSentence`):
```ts
const useLastFullSentence =
  trimmedTB.length > 0 &&
  lastFullSentence.length >= trimmedTB.length &&
  !sentenceTexts.includes(lastFullSentence);
const flushText = useLastFullSentence
  ? lastFullSentence
  : (trueRemainder.trim().length > trimmedTB.length ? trueRemainder : tokenBuf);
```

**How to identify:** In TTS execution logs, if the last TTS request text is missing the final word(s) of the transcript (e.g. transcript shows "பார்க்கலாமா?" but TTS got "பார்க்க"), it is this flush-truncation pattern — NOT tail clipping. Tail clipping is when TTS got the correct text but audio cuts off mid-word.
