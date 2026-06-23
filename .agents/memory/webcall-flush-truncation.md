---
name: Webcall flush truncation (tail-word drop)
description: Why the last word(s) of a reply get dropped — root cause + fix evolution, applies to both webcall.ts and pipeline.ts
---

## The bug
The last word(s) of an LLM reply (e.g. "சார்?", "லாமா?", "ீங்க?") are never sent to TTS and never spoken — seen intermittently.

## How to distinguish from tail-clip
- **Flush truncation**: check the TTS execution log. If the last TTS REQUEST text is missing the final word(s) of the transcript, the wrong text was sent upstream — this is flush truncation.
- **Tail-clip**: TTS REQUEST has the correct text, but audio is cut off mid-word during playback (VoBiz buffer underrun).

## Root causes

**Case A — Gemini adapter prefix miss:**
Gemini delivers the final streaming token only to `onComplete`, never to `onToken`. So `pendingText` at flush time is a truncated prefix of the last sentence — it ends without terminal punctuation. `trueRemainder` from `extractSentences(cleanResponse)` is longer and contains the complete tail → use it.

**Case B — Sentence-boundary edge case:**
When the last sentence ends with "?" (or "." / "!"), `extractSentences(cleanResponse)` returns `remainder=""` — the full sentence was captured in `sentences[]`. If `pendingText` is a prefix of `allSentences[-1]` (final token arrived in onComplete only), use the full last sentence.

**Case C — 60-char comma-split + Gemini prefix miss:**
The 60-char clause-split in `extractSentences` fires during streaming and emits the first part of a multi-clause sentence (e.g. "நீங்க அபார்ட்மெண்ட், இல்ல பிளாட், இல்ல வில்லா"). The remaining `pendingText` is a mid-sentence fragment (e.g. "எது பார்க்குற"). This is NOT a prefix of `allSentences[-1]` (which starts with "நீங்க..."), so Case B misses it. BUT it IS a substring of `allSentences[-1]` → search all sentences for a substring match, emit `sentence.slice(idx)` to recover the truncated tail ("எது பார்க்குறீங்க?").

## Current fix (pipeline.ts — both processTurn and continueWithToolResult flush sites)
```ts
const { sentences: allSentences, remainder: trueRemainder } = extractSentences(cleanResponse);
const pendingTrim = pendingText.trim();
let flushText: string;
if (trueRemainder.trim().length > pendingTrim.length) {
  // Case A
  flushText = trueRemainder;
} else if (pendingTrim) {
  const lastSentence = (allSentences.at(-1) ?? "").trim();
  if (lastSentence.startsWith(pendingTrim) && lastSentence.length > pendingTrim.length) {
    // Case B: pendingText is a prefix of the last sentence
    flushText = lastSentence;
  } else {
    // Case C: mid-fragment after comma-split — substring search
    let found = "";
    for (const s of allSentences) {
      const idx = s.indexOf(pendingTrim);
      if (idx !== -1 && s.length > idx + pendingTrim.length) {
        found = s.slice(idx);
        break;
      }
    }
    flushText = found || pendingText;
  }
} else {
  flushText = pendingText;
}
if (flushText.trim()) enqueue(flushText);
```

## Current fix (webcall.ts flush block)
Uses `useLastFullSentence` (length+queue check) — handles Cases A and B but not C. If Case C is seen on webcall, apply the same substring-search approach.

## Invariant to preserve
`cleanResponse` (from `onComplete`) is always the authoritative full reply. `pendingText` is always a partial that may be wrong. At flush time, derive the correct flush text from `cleanResponse`, never trust `pendingText` alone.
