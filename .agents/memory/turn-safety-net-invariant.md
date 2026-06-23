---
name: Turn safety-net is a Listening-state mechanism
description: Design invariant for the two-timer turn safety net (force-finalize + stall backstop) guarding the STT "Listening…" hang
---

The turn safety net (TurnSafetyNet in `endpointing.ts`: force-finalize timer +
stall backstop reprompt) is a **Listening-state-only** mechanism. It must be
dormant while the agent is speaking.

**Rules (must hold in BOTH `pipeline.ts` and `telephony/webcall.ts`):**
- `onPartial()` (arms/resets force-finalize) is gated on "not playing/speaking".
  Partials during agent playback are barge-in candidates, not turn-end signals.
- `onFinal()` (clears both timers) is **deferred out of the STT callback** to the
  point a transcript is actually *accepted* as a turn — i.e. AFTER the echo /
  leftover / end-grace discard checks. Calling it in the raw STT callback lets a
  later-discarded transcript silently clear the stall backstop → the hang returns.
- Every discard branch (echo, end-grace leftover) must call `beginListening()` to
  re-arm the stall and drop the stale best-partial, never leave the turn unguarded.
- A queued (isProcessing) transcript must carry its `closeReason` through to replay,
  or a force_finalized turn is mis-logged as stt_final.
- The separate **silence-hangup timer** (pipeline `resetHangupTimer` / webcall
  `resetHangupSilenceTimer`, driven by `agent.silenceTimeoutSeconds`) must also be
  reset on every accepted **partial** while listening — not just on finals. STT that
  streams partials but no final (Indic langs) otherwise hits the hangup timeout and
  the call drops mid-conversation even though the caller is actively talking.
- `onPartial()` itself also resets `repromptCount=0` + re-arms the stall backstop:
  active speech is the opposite of silence, so an actively-speaking caller must never
  be cut off by the reprompt give-up budget.

**Why:** an earlier impl cleared timers in the STT callback and armed force from
playback partials; both broke the Tamil/Hinglish hang fix. Two architect passes
flagged it. Normal English turns ending on a real STT final must fire NEITHER timer.

**How to apply:** any future edit to streaming-STT handling or barge-in/echo
discard logic must preserve the deferral + the !playing gate, and must be mirrored
in both paths (they are fully separate — see webcall-pipeline-split.md).
