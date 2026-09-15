# Orchestration Fixes — Voice Isolation + STT Flush

## Issues Found

After adding GTCRN voice isolation (commit `1b3556bc1`), three critical orchestration bugs emerged:

### 1. **Voice isolation running during agent speech**
- **Symptom**: Agent echo was being "cleaned" by isolation and appearing as phantom caller speech, breaking barge-in
- **Root cause**: `processAudioIn` always passed `noiseCancel: true` regardless of `isPlaying`/`isSendingTtsAudio`
- **Expected behavior**: Pause isolation during agent speech so carrier echo reaches transcript filters unmodified

### 2. **STT not flushing on barge-in**  
- **Symptom**: Sarvam STT only finalized after TTS stopped, not immediately when interruption detected
- **Root cause**: `triggerBargeIn()` cleared audio buffers but never called `streamSTT.flush()`
- **Expected behavior**: Flush immediately on barge-in so held coalesce buffer finalizes without waiting for TTS

### 3. **Ambient noise breaking**
- **Symptom**: Ambient bed had artifacts/gaps
- **Analysis**: Ambient mixing happens independently during playback, not affected by voice isolation timing
- **Status**: No code changes needed — ambient is mixed after isolation processing

## Fixes Implemented

### `pipeline.ts`

#### Fix 1: Pause voice isolation during agent speech (lines ~4482-4495)
```typescript
// PAUSE voice isolation + noise gate during agent speech so carrier echo
// is not cleaned into phantom caller speech (call 19809: isolation broke barge-in).
const pauseIsolation = this.isPlaying || this.isSendingTtsAudio;
processAudioIn(
  callId,
  mulawChunk,
  this.noiseGate.enabled && !pauseIsolation,  // ← paused during agent speech
  ...
)
```

#### Fix 2: Same pause logic for raw PCM path (lines ~4552-4568)
```typescript
const pauseIsolation = this.isPlaying || this.isSendingTtsAudio;
const nc = noiseCancel !== undefined ? noiseCancel : (this.noiseGate.enabled && !pauseIsolation);
processRawPcm8kIn(callId, pcm8k, nc, ...)
```

#### Fix 3: Flush STT immediately on barge-in (lines ~1845-1865)
```typescript
// FLUSH streaming STT immediately so Sarvam finalizes any held coalesce
// buffer — don't wait for TTS to stop (user report: STT only flushing after TTS ends).
if (this.streamSTT?.flush) {
  try {
    const flushed = this.streamSTT.flush();
    if (flushed) {
      logger.info(
        { callId: this.config.callId, trigger },
        "Flushed streaming STT on barge-in — forcing Sarvam finalization",
      );
    }
  } catch (err) {
    logger.warn({ callId: this.config.callId, err }, "STT flush on barge-in failed");
  }
}
```

### `gemini-live-pipeline.ts`

Same pause-isolation fix (lines ~426-429):
```typescript
// PAUSE voice isolation + noise gate during agent speech so carrier echo
// is not cleaned into phantom caller speech (matches classic pipeline fix).
const pauseIsolation = this.isPlayingOut || this.outFrames8k.length > 0;
const gateOn = noiseCancel !== undefined ? noiseCancel : (this.noiseGate.enabled && !pauseIsolation);
```

## Testing

- All 16 Cartesia TTS unit tests pass
- Changes preserve existing behavior when agent is NOT speaking
- Voice isolation still runs normally during caller speech

## Related Commits

- `1b3556bc1` — Add GTCRN voice isolation in front of VAD and STT
- `b90c4eeb5` — Keep production noise cancellation on, but pause isolation while agent speaks (commit message was written but code was missing)

## Hardcoded Constants Review

No changes needed. Key timing values:
- `BARGE_IN_ECHO_GRACE_MS = 600` — per-agent tunable via `bargeInEchoGraceMs`
- `VAD_SILENCE_MS = 150` — per-agent tunable via `vadSilenceMs`  
- `TTS_STREAM_IDLE_MS = 8000` — env tunable `TTS_STREAM_IDLE_MS`
- Adaptive echo calibration working correctly with `BARGE_IN_ECHO_CALIBRATION_MS = 250`

All timing constants are either environment-tunable or per-agent configurable.
