---
name: Outbound keepalive watchdog (gap-fill pump)
description: Why the ambient/keepalive pump must fill outbound gaps DURING a TTS sentence, not just between sentences, or the carrier drops the call.
---

# Outbound keepalive watchdog — fill gaps DURING a sentence, not just between

On outbound telephony there are two independent outbound senders that must never
BOTH be idle at once:
1. the ambient/keepalive **pump** — a 20ms `setInterval` that emits the ambient bed
   (or VoBiz keepalive zero frames) while the agent is NOT streaming TTS, and
2. per-sentence **TTS playback** — `drainLoop` (streaming) or a paced send loop
   (non-streaming) that only emits `onAudioOut` while its queue is non-empty.

**The trap:** the pump used to be gated purely on `!isSendingTtsAudio`, but
`isSendingTtsAudio` flips true at the *start* of `playSentence()` — BEFORE any TTS
byte exists. The drain only sends once the first byte arrives. So during the TTS
first-byte wait, or any mid-stream stall where the queue drains empty, the pump is
paused AND the drain is idle → **zero frames to the carrier** → agent voice AND the
continuous ambient bed go dead *together* → after ~2s VoBiz drops with hangup 4010.
Symptom: ~6s dead at answer then both arrive together; mid-call both vanish then
return; random auto-disconnects.

**Fix (in `orchestration/pipeline.ts`):** track `lastTtsFrameAt = Date.now()`
updated right after every REAL TTS frame (streaming drainLoop + both non-streaming
PCM/mulaw send loops), and change the pump guard to
`!isSendingTtsAudio || (Date.now() - lastTtsFrameAt) >= KEEPALIVE_FILL_GAP_MS`.
Now the pump ALSO fills any gap while a sentence is nominally in progress.

**Why the threshold is ~500ms (60ms was too tight):** the value was originally 60ms
on the theory that healthy streaming lands a frame every ~20ms so the gap stays under
threshold. In practice real streaming TTS is BURSTY — provider chunks arrive with gaps
of tens to a few hundred ms between frames — so 60ms constantly tripped and the pump
interleaved silence/ambient frames INTO live speech, producing a rapid chopping stutter
the user called a "helicopter" glitch. 500ms is loose enough to leave normal bursty
playback untouched while still bridging a genuine mid-sentence stall (provider hang)
long before the ~2s carrier drop. `lastTtsFrameAt` starts at 0 (epoch) so the very
first greeting first-byte window sees a huge gap and the pump fills immediately —
desired. **The balance to preserve:** aggressive enough to bridge a real stall before
VoBiz's ~2s 4010 drop, loose enough not to chop bursty frames. Do NOT tighten it back
toward the frame interval to "reduce dead air" — that reintroduces the helicopter.

**How to apply:** any new outbound sender path (new TTS mode, new transport) must
update `lastTtsFrameAt` on its real sends, or the watchdog will over-inject during
that path. Do NOT touch `drainPlaybackTail` — it runs after `isSendingTtsAudio` is
already false, so the pump already covers it (do not update `lastTtsFrameAt` there).

**Sender exclusivity (VoBiz voicemail/AMD path):** the AMD acoustic-confirmation
loop and the voicemail-delivery wait/lead-in loops pump their OWN 20ms silence
frames while holding the greeting. If the watchdog interval also fires in that
window (its guard sees `!isSendingTtsAudio`), TWO senders emit on the same 20ms
cadence → doubled frame rate → helicopter chop on the delivered voicemail. Rule:
**exactly one sender at any moment.** A `manualPumpActive`-style flag silences the
watchdog while a manual pump runs and is released just before `playSentence` so
the gap-fill still guards playback first-byte/stalls. Any future manual keep-alive
pump added to the pipeline MUST take this flag too, never coexist with the watchdog.
Also: a provider answer-webhook retry can open a second WS/session for the same
CallUUID (session map keys on internal sessionId) — the same doubled-audio failure;
guard duplicate live sessions by externalCallId on such paths.

**Scope:** this covers the first-byte and mid-call phases. The initial ~6s at
answer ALSO includes the `createSession` phase (VoBiz WS handshake, greeting gen,
greeting TTS first byte) handled in `telephony/vobiz.ts` BEFORE the pipeline pump
exists — that window is guarded by vobiz.ts's own silence timer, not this watchdog.
Related: `ambient-telephony-dtx.md` (channel continuity), `tts-tail-drain.md`.
