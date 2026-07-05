---
name: Self-echo guard silently dropped one-word replies
description: Why "yes"/"okay"-style one-word caller replies during agent playback vanished, and the fix shape
---

`isSelfEcho()` in `pipeline.ts` compares STT transcript tokens against tokens
from the agent's own recently-spoken lines, discarding the transcript as
carrier echo when overlap ratio >= `SELF_ECHO_MIN_OVERLAP` (0.6).

For a one-token transcript, ANY single incidental word match (e.g. the agent's
line contains "okay" or "yes" anywhere, which is common in TTS phrasing) is a
100% overlap ratio — so genuine short affirmations were being classified as
self-echo and dropped, even though STT correctly transcribed them.

**Why:** ratio-based overlap breaks down at low token counts; it was tuned for
multi-word phrase echoes, not single words.

**How to apply:** exempt known short reply words (`AFFIRMATIONS` set, now
exported from `endpointing.ts`) from the self-echo check entirely for 1-token
transcripts, and for any transcript with <=2 tokens require either an exact
match against the LAST token of the agent's recorded line (true carrier echo
bleeds in at the tail) or >=2 matched tokens — not just a ratio. Real defense
against literal echo of short words stays in the time-window tail-echo guard
and the ~600ms per-sentence echo grace, both upstream of this check.
