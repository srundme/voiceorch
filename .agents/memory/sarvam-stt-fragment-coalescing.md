---
name: Sarvam STT streaming fragment coalescing
description: How the adaptive coalescing decides whether a streaming segment is a complete turn vs. a mid-thought fragment, and its known blind spots.
---

`looksIncomplete()` (in the Sarvam streaming STT adapter) decides whether a
just-arrived transcript segment should be held for more speech or flushed as a
finished turn. It has thorough Tamil/Hindi grammatical-ending coverage but,
until this fix, only a tiny English connective list (and/or/but/...). Short
English clauses ending in a bare transitive/mental-state verb with no object
yet ("I want", "I need", "I have") were flushed as complete turns, producing
garbled follow-on turns once the caller's next words arrived as a *new* turn
instead of a continuation.

**Why:** confirmed against a real call log (call-1659) — turn 6's entire turn
was the two words "I want"; the rest of the sentence became disconnected
fragments in later turns ("I want a No good. worth pricing").

**How to apply:** if new mishearing reports show a short bare-verb English
fragment becoming its own turn, add the verb to `NEEDS_OBJECT_VERBS` in
`sarvam.ts`. This heuristic only fires when the buffer lacks terminal
punctuation — don't remove that guard, it prevents false positives on
legitimately short complete answers ("I agree.").

**Known separate, NOT a bug:** the turn-safety-net `STALL_BACKSTOP_MS`
(default 10s) firing a "Sorry, I didn't catch that" reprompt after genuinely
zero usable transcript is *expected* behavior, not a coalescing failure. A
real ~10-13s dead-air gap in a call log with a "Silence Reprompt" event means
Sarvam produced nothing at all for that window (WS zombie, or the caller's
audio genuinely wasn't recognized) — distinct from the fragment-splitting
issue above and not fixed by touching `looksIncomplete()`.

**Also observed, unresolved:** Sarvam's `mode: "codemix"` can transcribe
clearly-English speech as Tamil script even when `language_code=en-IN` is
set — a Sarvam-side accuracy limitation, not something `langCode`/`mode`
config in our adapter currently controls per-segment. No fix implemented;
mode is fixed per-call at WS-open time and changing the default risks
breaking legitimate Tamil/English code-switching for other agents.

**Listening-state hold (Jul 2026):** the pipeline's 2s fragment-coalesce hold for
backchannel-only utterances ("Okay", "சரி") applied even when the agent was silent,
adding 2s dead air to every short ANSWER. Fixed: hold is now context-dependent —
2000ms while agent audio is playing (true backchannel), 450ms when listening
(FRAGMENT_COALESCE_LISTENING_MS in pipeline.ts). If short replies feel slow again,
check this split first.
