---
name: VoBiz carrier-native noise cancellation
description: VoBiz denoises all calls at its telecom media layer with no API toggle; our software noise gate is bypassed on VoBiz-carried calls.
---

# VoBiz carrier-native noise cancellation

**Rule:** VoBiz performs noise removal / voice isolation natively in its media layer on EVERY call. There is no API parameter to enable/disable it — verified by sweeping the complete VoBiz docs corpus (llms.txt + llms-full.txt + `<Stream>` attributes + make-call params, Jul 2026): zero mentions of noise/isolation anywhere in the API surface. Marketing's "noise cancellation / voice isolation / HD voice" claims are automatic telecom-layer processing, not opt-in features.

**Consequence in our pipeline:** the VoBiz WS media handler passes `noiseCancel=false` to `onRawPcm8kIn`, so the software noise gate (NoiseCanceller attenuation) never runs on VoBiz-carried audio — same treatment as webcall (browser AEC). The agent's `noiseCancellationEnabled` toggle still governs Twilio/Plivo, which do no carrier-side cleanup.

**Why:** running our gate on already-denoised audio is double-processing with documented history of attenuating quiet one-word replies ("yes"/"okay"). Carrier NC upstream + software gate downstream compounds that loss risk for zero benefit.

**Escape hatch:** `VOBIZ_FORCE_SOFTWARE_NC=1` (env) re-applies the software gate on VoBiz calls if carrier-side NC ever proves insufficient in the field.

**How to apply:**
- Mic Sensitivity's `gateRatio` lever is deliberately inert on VoBiz calls (gate bypassed); `vadThreshold` + barge-in thresholds still fully apply — the worker computes VAD/hasSpeechEnergy on every frame regardless of the noiseCancel flag.
- Don't "fix" background-talker complaints on VoBiz by re-enabling the software gate first — check VOBIZ_FORCE_SOFTWARE_NC tradeoffs and the mic-sensitivity vadThreshold lever before stacking a second denoiser.
- Related marketing claims decoded: "80 ms latency" = their carrier routing latency (unrelated to our pipeline TTFT); "stereo recording" = their recording feature, which we don't use (we record in-pipeline).
