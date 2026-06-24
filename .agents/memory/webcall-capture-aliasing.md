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

**The rule:** band-limit BEFORE any rate reduction. Insert a low-pass biquad cascade
(~7 kHz, 3 stages ≈ 36 dB/oct) between the MediaStreamSource and the resampler whenever
`ctx.sampleRate !== 16000`. When the context is genuinely 16 kHz the filter is skipped
(no decimation = nothing to alias).

**Current location (Webcall 2.0):** there is now exactly ONE capture site —
`components/webcall-panel.tsx`. It uses an inline AudioWorklet that posts raw Float32
frames; the main thread band-limits (the biquad cascade) then linear-resamples to 16 kHz
with a fractional cursor + leftover tail carried across frames (no click at boundaries).
The old shared helper `lib/webcall-capture.ts` and the `pages/assistants.tsx` capture
graph BOTH described in earlier revisions of this note were removed with the webcall 1.0
purge — do not look for them. `assistants.tsx` now only renders `<WebcallPanel>`.

**Validation can only run on a real ctx ≠ 16000 device.** The fix is a no-op on contexts
already at 16 kHz, so a test on such a device proves nothing. Telephony/live-call audio is
a completely separate path and is unaffected.
