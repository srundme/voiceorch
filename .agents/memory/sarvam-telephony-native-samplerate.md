---
name: Sarvam telephony STT native sample rate
description: Telephony calls now send native 8kHz to Sarvam STT instead of linear-interpolation-upsampled 16kHz; webcall unaffected
---

Telephony audio (VoBiz etc.) is native 8kHz PSTN. Before this fix, the code unconditionally
upsampled it to 16kHz via naive linear interpolation (`upsample8to16`) before sending to STT,
on both the streaming (`transcribeStream`/`sendAudio`) and batch (`flushAndProcess`/`transcribe`)
paths — even though Sarvam's API natively supports `sample_rate=8000`.

**Why:** manufacturing fake samples via interpolation doesn't add real information and can
introduce artifacts on already-lossy phone audio, which was suspected as a contributing cause
of severe telephony-only mishearings (whole-phrase substitutions) that didn't occur on webcall
(native 16kHz mic, no interpolation involved).

**How to apply:** `STTConfig.nativeSampleRate` (types.ts) lets the Sarvam adapter (`sarvam.ts`)
stream/send at 8000 for telephony instead of 16000. `Pipeline` computes this once at
construction (`isTelephonySarvam = asrProvider==="sarvam" && telephonyProvider!=="webcall"`)
and stores `this.sttSampleRate`, used at both STT call sites to pick `pcm8k` vs `pcm16k`. If
adding another STT provider that also supports 8kHz natively for telephony, follow the same
pattern rather than hardcoding 16000 in the adapter.

Separately, the telephony-only `NoiseCanceller` (audio.ts, GATE_RATIO=4.0) hard-zeros whole
20ms frames below its adaptive noise floor rather than attenuating — but it's OFF by default
(`agent.noiseCancellationEnabled ?? false`), so it only matters for agents that explicitly
enabled it. If a user with noise cancellation ON reports similar mishearing, that gate is the
next suspect (consider soft attenuation instead of hard zeroing).
