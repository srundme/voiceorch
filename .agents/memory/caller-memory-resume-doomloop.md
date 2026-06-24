---
name: Caller-memory resume doom-loop
description: Why dropped-call "resume from here" memory must be quality-gated, and why an unresumable drop must cold-start instead of falling to the returning-caller branch.
---

# Caller-memory resume doom-loop

The L2 "resume thread" feature in `injectEnhancedMemory` (callerMemory.ts) injects the
tail of an abruptly-ended prior call plus a strong "RESUME, DO NOT RESTART" instruction
whenever `isAbruptEnd(profile)` is true. This can self-perpetuate into a doom loop.

**The loop:** a call ends badly (model looping the same line / STT garbage) → saved as a
dropped call → next call injects that broken tail as "resume from here" → the agent's
GREETING becomes a verbatim copy of the broken line, never gives its scripted brand/persona
opening, stays off-script → caller hangs up → re-saved as dropped → feeds the next call.

## Rules

1. **Quality-gate resume.** Only resume when the prior tail is a coherent exchange
   (`isResumableTail`): reject exact/near-duplicate agent lines (looping), all-agent tails,
   and caller turns that are empty or a single repeated token (STT garbage). Require ≥1
   caller line with ≥2 distinct words.
2. **Unresumable drop = cold start, NOT returning-caller.** When a drop is rejected for
   resume, do NOT fall through to the returning-caller branch — that branch says "do NOT
   introduce yourself" and references the (now contaminated) profile summary / predictedIntent
   / recent episodes, which still suppresses the scripted opening. Instead treat it exactly
   like a persona change: `suppressDomain = personaChanged || unresumableDrop` gates ALL
   domain-bearing blocks. Only the caller name + name-priority rule survive.

**Why:** observed on a sarvam-30b Hindi insurance agent — the greeting was literally the
dropped-call resume line; the agent never said its scripted intro and the call re-dropped,
feeding the next call.

**How to apply:** any change to dropped-call / returning-caller memory injection must keep
`resumeDrop` (gates header/tail/RESUME instruction) and `suppressDomain` (gates all stale
domain memory) distinct. Fail-safe direction is "not resumable" — a false positive just
yields the normal scripted opening, which is the desired behaviour anyway.
