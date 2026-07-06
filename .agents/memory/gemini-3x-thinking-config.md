---
name: Gemini 3.x thinking config differs from 2.x
description: Gemini 3.x models use thinkingLevel instead of thinkingBudget and cannot fully disable thinking — matters for any latency-sensitive Gemini integration.
---

Gemini 2.x (`gemini-2.5-*`) uses a numeric `thinkingConfig.thinkingBudget` —
`0` fully disables thinking, zero reasoning overhead. Gemini 3.x
(`gemini-3.*`, e.g. `gemini-3.1-flash-lite`, `gemini-3.5-flash`) replaced this
with `thinkingConfig.thinkingLevel` (`minimal`/`low`/`medium`/`high`) and
**cannot fully turn thinking off** — `minimal` is the closest equivalent but
the model may still think briefly. Sending both `thinkingBudget` and
`thinkingLevel` in the same request is an API error, so any adapter
supporting both model families must branch on the model string.

**Why:** discovered while adding gemini-3.1-flash-lite/gemini-3.5-flash as
model options in a low-latency voice pipeline that had hardcoded
`thinkingBudget:0` for the entire "gemini" provider — that hardcoding would
have either errored (if the field is rejected) or been silently ignored on
3.x, reintroducing 2-5s of unwanted TTFT.

**How to apply:** when adding a new Gemini model option, check whether it's
in the 3.x family before assuming existing thinking-disable logic still
applies. `gemini-2.5-flash-lite` remains the only fully-zero-thinking-latency
Gemini model as of this writing; 3.x models trade a small amount of latency
for materially better reasoning/instruction-following.
