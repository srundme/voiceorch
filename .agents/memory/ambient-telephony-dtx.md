---
name: Ambient bed survives telephony only if channel stays "active"
description: Why a synthetic ambient noise bed is audible on web calls but inaudible on real PSTN/mobile, and how to keep it alive.
---

# Ambient inaudible on real phone calls — it's carrier DTX, not "too quiet"

Web-call ambient and telephony ambient share the SAME `agentConfig` fields
(`ambientNoiseEnabled`/`ambientNoiseTrack`) and the SAME pipeline block
(`AmbientNoiseStream` constructed in `pipeline.ts`). So if web ambient works,
config IS flowing and the stream IS constructed on telephony too — any
"inaudible on real calls" report is a **transport** problem, not config.

**Mechanism:** a mobile carrier / PSTN interconnect runs VAD + DTX
(discontinuous transmission) + comfort-noise on the downlink. Two things make
it suppress a background bed while the loud agent voice always passes:
1. **Pure digital-silence gaps.** The telephony tail-drain
   (`drainPlaybackTail`) used to emit ~800 ms of `Buffer.alloc(0)` frames after
   *every* utterance (the ambient silence-fill interval is paused while
   `isPlaying` is true, and it's still true during the drain). A run of zero
   frames = inactive channel → DTX engages → it then gates the low-level
   ambient bed when it resumes.
2. **Flat, steady-state noise.** Even above threshold, a flat low-level hiss
   reads as line noise and gets suppressed.

**Fix (both needed):**
- Never emit pure-zero frames when ambient is enabled — carry the ambient bed
  through the drain window (`nextMulawChunk`/`nextPcmChunk`), gated on
  `this.ambientStream` so the disabled path stays byte-for-byte identical.
- Give the generated bed natural movement: a slow amplitude envelope (LFOs at
  whole-cycle-per-8s-loop rates so the loop stays seamless, floored ~0.6 so it
  never dips to silence) + a moderate level bump. Raising dBFS *alone* does
  nothing if DTX is gating it.

**Why:** -21 dBFS steady is NOT quiet — if it were transmitted you'd hear it.
Inaudibility at that level means it's being *suppressed*, so the lever is
channel-activity/continuity, not volume.

**How to apply:** any new path that sends silence to a live telephony caller
(keepalives, drains) must carry ambient instead of zeros when ambient is on.
Validate empirically on a real PER-PROVIDER call (Twilio/Plivo/Vobiz) — dBFS
math is not sufficient.
