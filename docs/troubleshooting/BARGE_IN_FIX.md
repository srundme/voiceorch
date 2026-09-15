# Barge-in Fix: Background Talker Filter Only During Listening

## Issue

After deploying the orchestration fix, **interruption (barge-in) stopped working**.

## Root Cause

The background talker filter (sending silence for `rawRms < 1200`) was applied **ALL THE TIME**, including during agent playback:

```typescript
// Previous (BROKEN for barge-in):
if (rawRms > 0 && rawRms < BACKGROUND_TALKER_MIN_RAW_RMS) {
  // Silence sent to STT — even during agent playback!
  this.streamSTT.sendAudio(silentFrame);
}
```

**Problem:**
1. Agent is speaking (TTS playback)
2. User tries to interrupt with `rawRms < 1200`
3. Silence sent to STT instead of caller audio
4. STT doesn't see the speech → no transcript → **no barge-in**

## Solution

**Only apply the background talker filter during LISTENING phase** (when agent is NOT speaking):

```typescript
// Fixed:
const agentSpeaking = this.isPlaying || this.isSendingTtsAudio;
if (!agentSpeaking && rawRms > 0 && rawRms < BACKGROUND_TALKER_MIN_RAW_RMS) {
  // Only filter during listening phase
  this.streamSTT.sendAudio(silentFrame);
} else {
  // During playback: ALL caller audio goes to STT for barge-in
  this.streamSTT.sendAudio(sttFrame);
}
```

### Why This Works

- **During agent playback** (`isPlaying || isSendingTtsAudio`):
  - ALL caller audio (even low energy) goes to STT
  - Barge-in works normally (transcript-based + energy-based)
  - User can interrupt the agent

- **During listening phase** (after agent stops):
  - Low-energy frames (`rawRms < 1200`) → silence sent to STT
  - Background talkers filtered out
  - Only phone holder's speech transcribed

## Changes

**`pipeline.ts`:**
- Added `agentSpeaking` check before applying background talker filter
- Updated comment to clarify filter only applies during listening phase
- Changed log message: "Background talker energy (listening phase) — replacing with silence for STT"

## Impact

### Before Fix
- ✗ Barge-in broken (interruption didn't work)
- ✗ All caller audio during playback filtered by energy threshold

### After Fix
- ✓ Barge-in works (caller can interrupt during agent playback)
- ✓ Background talkers still filtered during listening phase
- ✓ Language detection only responds to phone holder (not background speakers)

## Testing

1. **Barge-in test**: Interrupt agent mid-sentence — should work
2. **Background talker test**: Have friend speak during listening phase — should NOT be transcribed
3. **Language switching test**: Background speaker should NOT trigger language change

All pipeline invariant tests pass ✓
