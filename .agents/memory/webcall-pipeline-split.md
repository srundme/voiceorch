---
name: Webcall 2.0 is a thin transport adapter (NOT a pipeline duplicate)
description: Browser webcall now delegates to the shared createSession/OrchestrationPipeline core; do NOT re-add duplicated conversation logic to webcall.ts
---

**Rule:** `artifacts/api-server/src/orchestration/telephony/webcall.ts` is a THIN WS
transport adapter (~150 lines) over the SAME `createSession` / `OrchestrationPipeline`
core that telephony uses. It must NEVER reimplement conversation logic. When you add an
orchestration feature (barge-in, endpointing safety-net, flush, tail-drain, greeting
markup stripping, tool calling, STT fallback, caller memory), add it to the SHARED core
only — webcall inherits it for free and stays in parity automatically.

**Why:** Webcall 1.0 was a ~3800-line near-duplicate of `pipeline.ts`. Every webcall bug
(echo, language drift, flush truncation, tail clipping, deaf-socket) came from that fork
drifting out of sync. 2.0 deleted the fork. The old memory note here said the opposite
("duplicate every pipeline feature into webcall.ts") — that is now exactly the
anti-pattern to avoid.

**How to apply:**
- webcall.ts only does: PCM16 16k mic in → `downsample16to8` → `session.pipeline.onRawPcm8kIn`;
  pipeline `onAudioOut` 8k PCM → binary WS frame; JSON `ready|transcript|clear|call_end|error`.
- It uses `createSession({ telephonyProvider: "webcall", rawPcmOutput:true, onAudioOut,
  onBargeIn, onCallEnd, onTranscript })`. The pipeline never branches on the "webcall"
  transport value — it's just a label (SessionTransport = TelephonyProvider | "webcall").
- Synthetic non-phone caller ids (`webcall-user-<sub>` / `webcall-agent-<id>`) make
  `humanPhone()` return null on purpose → caller-memory skipped so tests don't pollute it.
- WS transport gotchas (all bit during the build):
  attach ws message/close/error listeners BEFORE awaiting createSession (else a
  close/end during slow setup is lost and the session leaks until max-duration);
  discriminate frames on `isBinary` ONLY (`ws` delivers text frames as a Buffer, so a
  `Buffer.isBuffer()` check treats `{type:"end"}` as audio); redact `?token=` JWT from any
  WS upgrade log; client must resample mic to 16k from the ACTUAL AudioContext rate AND
  band-limit before decimating — see webcall-capture-aliasing.md.

**Stale 1.0-era notes:** entries describing webcall's own extractSentences / flush /
echo-grace / content-echo / sendAudio invariants (extract-sentences-regex-parity,
webcall-extract-sentences, webcall-flush-truncation, webcall-echo-grace-rearm,
webcall-content-echo, webcall-sendaudio-invariant) referred to the deleted fork. The
pipeline.ts side of each may still hold; the webcall side no longer exists.
