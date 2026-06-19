---
name: extractSentences clause-split regex parity
description: pipeline.ts and webcall.ts each have their own clause-split regex; they must stay in parity for the Indic Unicode range or Tamil/Indic turns duplicate or drop clauses
---

# extractSentences clause-split regex parity

Both audio paths have a **separate, copy-pasted** `extractSentences` with its own
`shouldSplit` character class for period+space sentence boundaries:

- `pipeline.ts` (telephony)
- `webcall.ts` (browser WS)

The split char class must include the Indic range **`\u0900-\u0D7F`** (alongside
`A-Z"'(\u2018\u201C`). Indic scripts have no uppercase, so without that range a
period followed by a Tamil/Hindi word is never treated as a mid-sentence boundary
during streaming.

**Why:** when pipeline could not split mid-sentence, its end-of-stream flush
re-enqueued an already-spoken opening clause → **duplicated head** on every Tamil
phone turn (e.g. `"வணக்கம். வணக்கம். நான்…"`). webcall already had the range, so it
was correct; pipeline was the one that drifted.

**How to apply:** treat the two regexes as a single invariant — any edit to the
clause-split char class in one file must be mirrored in the other. Before changing
either, diff the two `shouldSplit` regexes; the ONLY expected difference historically
was this Indic range (now fixed), so any other divergence is a real bug to report.

**Test:** `artifacts/api-server/src/orchestration/extract-sentences.test.ts` drives
the REAL exported `extractSentences` through the streaming + end-of-stream flush at
token granularities 1/3/8/whole-shot and asserts no duplicated clause + full-text
coverage. Importing `pipeline.ts` into vitest works but is heavy (~9s import);
a future refactor could extract `extractSentences` into a shared lib used by both
paths to kill both the drift risk and the heavy test import.
