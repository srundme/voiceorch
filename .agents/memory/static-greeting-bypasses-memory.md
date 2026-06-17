---
name: Static greeting bypasses caller memory
description: Why a configured greetingMessage must be skipped for returning callers, on both call paths
---

A configured `greetingMessage` is spoken verbatim and never goes through the
LLM, so it ignores the injected CALLER MEMORY block entirely. The LLM greeting
path (empty/absent greetingMessage) DOES see memory because it generates from
the memory-injected system prompt.

**Rule:** any "memory-aware opening" behavior (recognize returning callers,
resume a dropped thread) must force the LLM greeting path and skip the static
greeting when the caller is returning. This must be done in BOTH greeting
implementations — they are independent (see webcall-pipeline-split):
- pipeline.ts `greet()` (phone path) — gated on `SessionConfig.isReturningCaller`
- webcall.ts inline greeting block — gated on `webcallProfile.callCount >= 1`

**Why:** caller memory is loaded and injected for both paths, but the opening
still felt "cold" because the static greeting short-circuits before the LLM
runs. Returning = `callCount >= 1` (profile is created at the END of the first
call, so the 2nd call sees callCount 1).

**How to apply:** when adding greeting-time personalization, check whether the
static-greeting fast path needs to be bypassed; if it does, do it symmetrically
on both paths or behavior will diverge between web calls and phone calls.
