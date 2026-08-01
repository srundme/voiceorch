---
name: TTS jitter buffer in drainSentenceJob
description: Why streaming TTS playback pre-buffers before the paced pump, and the echo-grace re-anchor rule
---
Streaming TTS playback (drainSentenceJob pump) waits for ~300ms of queued PCM (TTS_PREBUFFER_MS, cap 600ms) before starting the 20ms paced send loop, and re-buffers ~160ms (cap 400ms) on mid-sentence underrun instead of resuming on the next 20ms chunk.

**Why:** playback used to start on the FIRST 20ms chunk, so every momentary Sarvam stream hiccup became an audible gap ("sticking" voice on telephony — a 14.9s greeting took 17.3s to play, 2.4s of stalls).

**How to apply:** any change here MUST re-anchor `bargeInSentenceStartAt = Date.now()` AFTER the prebuffer wait — otherwise the 600ms echo grace is consumed while buffering and adaptive echo-floor calibration samples caller audio as "echo" (architect-flagged regression). All four knobs are env-overridable (TTS_PREBUFFER_MS / _CAP_MS, TTS_REBUFFER_MS / _CAP_MS).
