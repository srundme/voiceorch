---
name: Web-call mic capture anti-aliasing
description: Why browser web-call recordings buzz on the caller channel and the band-limit-before-decimate rule for the two capture sites
---

# Web-call mic-capture aliasing (caller-channel buzz)

Web-call recordings intermittently get full-scale white-noise ("helicopter/static/buzz")
bursts on the **caller (left)** channel during loud, sibilant caller speech; live
telephony recordings are clean.

**Root cause (not code-derivable):** the browser does NOT reliably honor the requested
16 kHz `AudioContext` sample rate — it commonly runs at 44.1/48 kHz. The capture path
reduced the rate by naive linear-interpolation decimation with NO anti-aliasing filter,
so high-frequency caller energy folded back into decorrelated broadband noise. The same
corrupted frames feed BOTH STT and the server recorder, so the buzz is baked into the WAV.
At 48 kHz the decimator degenerates to pure 3:1 decimation → maximal aliasing.

**The rule:** band-limit BEFORE any rate reduction. The shared helper
`artifacts/dashboard/src/lib/webcall-capture.ts` (`startMicCapture`) inserts a low-pass
biquad cascade (~7 kHz, 3 stages) between the MediaStreamSource and the ScriptProcessor
whenever `ctx.sampleRate !== 16000`, then resamples. When the context is genuinely 16 kHz
the filter is skipped (no decimation = nothing to alias).

**Why two capture sites must share one helper:** there are TWO independent web-call mic
graphs — `components/webcall-panel.tsx` (embedded panel) and `pages/assistants.tsx` (agent
test panel). They previously kept private copies of `float32ToInt16`/`downsampleFloat32`,
and `assistants.tsx` sent `getChannelData(0)` with NO resample at all (broken on any
non-16k context). Any capture-chain change must go through the shared helper or one path
silently regresses.

**Validation can only run on a real ctx ≠ 16000 device.** The helper logs
`[webcall-capture] AudioContext sampleRate=…Hz path=native-16k|resampled` at call start so
a tester can confirm the resample path was actually exercised. The fix is a no-op on
contexts already at 16 kHz, so a test on such a device proves nothing. Telephony/live-call
audio is a completely separate path and is unaffected.
