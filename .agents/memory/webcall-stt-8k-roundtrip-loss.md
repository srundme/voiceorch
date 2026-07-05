---
name: Webcall STT mishears short words due to 8k downsample/upsample roundtrip
description: Why "VoBiz" got transcribed as "Bobby" on webcall, and how the fix threads native 16k audio through
---

Webcall's browser mic captures real 16kHz audio, but the ingress path
(`webcall.ts`) immediately called `downsample16to8()` before ever reaching the
pipeline. That halves the Nyquist limit to 4kHz, destroying high-frequency
fricative energy ("v", "z", "s") — exactly what distinguishes a word like
"VoBiz" from "Bobby". The audio worker then reconstructs a "16k" buffer via
`upsample8to16()` for STT, but that's pure linear interpolation of the
already-narrowed 8k signal — it cannot recover lost frequencies. Telephony
audio is unaffected (it's natively 8k/µ-law, no round trip).

**Why:** the 8k pipeline exists for VAD/DTMF/energy detection, which don't
need >4kHz content, but STT was being fed the same lossy 8k-derived signal
instead of the real mic audio.

**How to apply:** `onRawPcm8kIn()` in `pipeline.ts` now accepts an optional
`nativePcm16k` param; webcall passes the true 16k buffer alongside the
downsampled 8k copy. A FIFO queue (`nativePcm16kQueue`, safe because worker
results resolve in strict per-call order) pairs it with the worker's result in
`handleProcessedAudio`, and both the streaming-STT feed and batch
`flushAndProcess` (via a parallel `audioBufferNative16k` array mirroring
`audioBuffer`) prefer the native chunk over the worker's `pcm16k` when
present. Telephony paths never pass the third arg, so their behavior/output is
unchanged.
