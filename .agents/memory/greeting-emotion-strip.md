---
name: Emotion tags in LLM-generated greeting not stripped
description: pipeline.ts and webcall.ts greeting paths only stripped <think> tags; <emotion> and <break> tags leaked into the call transcript and were passed raw to TTS.
---

The rule: any post-LLM text cleanup that strips `<think>` must ALSO strip `<emotion>` and `<break>` tags. Use a shared pattern:
```ts
text = text
  .replace(/<think>[\s\S]*?<\/think>/g, "")
  .replace(/<\/?emotion[^>]*>/gi, "")
  .replace(/<break[^>]*\/?>/gi, "")
  .replace(/[^\S\r\n]{2,}/g, " ")
  .trim();
```

**Why:** Some LLM models (especially voice-oriented or multilingual ones) generate `<emotion value="neutral">…</emotion>` SSML-style markup. The per-turn `cleanReply` in webcall already stripped these, but the greeting text path was a separate code path that only had the `<think>` regex. The raw text was then:
1. Stored in the call transcript — users saw the angle-bracket tags in the call log.
2. Passed verbatim to the TTS adapter — some providers may speak the tag text literally.

**How to apply:** Wherever you see `greeting = greeting.replace(/<think>[\s\S]*?<\/think>/g, "")` in pipeline.ts or webcall.ts, extend the chain to include the emotion/break regex. Also add to the system prompt's TTS rules: "NEVER use XML or SSML markup tags — the TTS engine speaks them aloud literally."
