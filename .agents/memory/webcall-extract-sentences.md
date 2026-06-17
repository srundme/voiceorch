---
name: Webcall extractSentences tuple shape
description: extractSentences returns different shapes in pipeline.ts vs webcall.ts
---

## Rule
`extractSentences` in `webcall.ts` is defined locally (line ~93) and returns `[string[], string]` (tuple).
In `pipeline.ts`, the import from `sentenceUtils.ts` returns `{ sentences: string[], remainder: string }` (object).

## Why
The two files evolved independently. webcall.ts inlined a local version; pipeline.ts uses the shared util.

## How to apply
When copying LLM token-callback code between the two files, always check the destructure pattern:
- webcall.ts: `const [sentences, remainder] = extractSentences(buf);`
- pipeline.ts: `const { sentences, remainder } = extractSentences(pendingText);`
