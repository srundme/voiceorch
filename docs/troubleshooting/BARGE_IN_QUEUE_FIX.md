# Barge-In Transcript Queueing Fix

## Problem
**User Report**: "still stt is queing the intruption"

Despite previous barge-in fixes, transcripts were still being queued during interruptions instead of processing immediately, causing the "unrealistic call flow" where the user interrupts but their speech is only heard AFTER the AI finishes.

## Root Cause
Race condition in `bargeInRequested` flag timing:

1. User interrupts → `bargeInRequested = true`
2. First transcript arrives → Correctly bypasses queue (bargeInActive=true) ✅
3. **`processTurn()` starts → IMMEDIATELY resets `bargeInRequested = false`** ❌
4. User still speaking → Second/third transcript arrives
5. Check `bargeInActive` → **NOW FALSE** → Gets queued! ❌

The bug was resetting the barge-in flag at the **start** of turn processing (line 8611), when it should be reset at the **end** of playback.

## Solution
**Move `bargeInRequested = false` from turn start to playback completion**

### Changes in `pipeline.ts`

#### 1. Remove reset at turn start (line ~8611)
```typescript
private async processTurn(transcript: string, sttLatencyMs: number): Promise<void> {
  transcript = sanitizeSpokenEmailsInTranscript(transcript);
  this._processTurnGeneration = this.semanticTurnGate.turnGeneration;
  // BARGE-IN FIX: Do NOT reset bargeInRequested at the START of the turn.
  // Instead, reset it at the END of playback (after await playPromise).
  // this.bargeInRequested = false;  // ← REMOVED
  this.bargeInSpeechFrames = 0;
```

#### 2. Add reset after main playback completes (line ~10827)
```typescript
await playPromise;

// BARGE-IN FIX: Reset bargeInRequested AFTER playback completes.
// This ensures that any transcripts arriving DURING this turn's playback are
// correctly identified as barge-ins and processed immediately (not queued).
this.bargeInRequested = false;

// Bolna parity: store only what the caller actually heard...
```

#### 3. Add reset after tool result playback (line ~11772)
```typescript
await playPromise;

// BARGE-IN FIX: Reset bargeInRequested after tool-result playback completes.
this.bargeInRequested = false;

// ── Chained tool call — the agent invoked another tool off the result ──
```

#### 4. Add reset in error paths (lines ~10557, ~10576, ~11690)
```typescript
await playPromise;
// BARGE-IN FIX: Reset after error path playback.
this.bargeInRequested = false;
throw fallbackErr; // or llmErr, or return
```

## Impact
✅ **Immediate barge-in processing**: All transcripts during an active barge-in now process immediately, maintaining conversation flow  
✅ **No transcript queueing during interruptions**: User speech is heard in real-time, not after AI finishes  
✅ **Race condition eliminated**: The barge-in flag persists for the entire duration of turn processing  

## Testing
1. **Interrupt during agent speech**: Speak while agent is talking → transcript should process immediately
2. **Multiple words during interrupt**: Say full sentence while interrupting → all words process in real-time, not queued
3. **Rapid interrupts**: Interrupt repeatedly → each interrupt processes immediately
4. **Normal turns**: After agent finishes → bargeInRequested correctly resets, normal queuing resumes

## Deployment
- **File**: `artifacts/api-server/src/orchestration/pipeline.ts`
- **Lines changed**: ~8611 (removed reset), ~10827, ~10557, ~10576, ~11690, ~11772 (added resets)
- **Risk**: Low — only changes timing of flag reset, does not affect core logic
- **TypeScript**: ✅ No errors

## Monitoring
Watch for:
- `"bargeInFiredTotal"` in logs (should be > 0 when interrupting)
- `"pendingTranscriptQueue"` length during barge-in (should be 0)
- User feedback on interruption responsiveness

---
**Commit**: Barge-in queue fix - reset flag after playback, not at turn start
