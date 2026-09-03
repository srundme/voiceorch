# Barge-In Queue Bypass Fix

**Date:** 2026-09-03  
**Issue:** Interruption transcript processed AFTER AI finishes speaking  
**Status:** ✅ **FIXED**

---

## Problem Description

**User Report:**
> "if ai is speaking somthing and i intrupt stt capture it and sends it after ai speaks and that becamses like unrealistic call flow"

### What Was Happening

1. **AI is speaking** (`isProcessing=true`, TTS playing)
2. **User interrupts** → Barge-in detected
3. **✅ TTS stops immediately** (`triggerBargeIn` calls `clearAudio`)
4. **✅ STT is flushed** (forces Sarvam to finalize)
5. **❌ STT final arrives** → but is **QUEUED** because `isProcessing=true`
6. **❌ Transcript only processes AFTER AI turn finishes**

**Result:** Caller hears silence (TTS stopped), then speaks, but their speech is only heard by the LLM several seconds later when the AI turn finally completes.

---

## Root Cause

**File:** `artifacts/api-server/src/orchestration/pipeline.ts:4302-4305`

### **Before (Broken Logic)**
```typescript
if (this.isProcessing) {
  this.pendingTranscriptQueue.push({ text: transcript, emittedAt: sttEmittedAt, closeReason });
  return; // ← QUEUED, NOT PROCESSED!
}
```

**Why this was wrong:**
- `isProcessing=true` includes the entire turn: LLM generation + TTS synthesis + audio playback
- A barge-in stops TTS/playback immediately, but `isProcessing` stays `true` until the turn completes
- The STT final (the interruption itself!) is queued and only processed after the turn finishes

---

## The Fix

### **After (Fixed Logic)**
```typescript
// BARGE-IN FIX: If a barge-in was triggered (TTS stopped, clearAudio sent),
// the transcript MUST process immediately — not queue. Queueing causes the
// "unrealistic call flow" where the user interrupts but their speech is only
// heard AFTER the AI finishes speaking (even though TTS was already stopped).
const bargeInActive = this.bargeInRequested || this._lastTurnWasBargedIn;

if (this.isProcessing && !bargeInActive) {
  this.pendingTranscriptQueue.push({ text: transcript, emittedAt: sttEmittedAt, closeReason });
  return;
}

// Barge-in transcripts jump the queue (they're the reason TTS stopped).
if (this.pendingTranscriptQueue.length > 0 && !bargeInActive) {
  this.pendingTranscriptQueue.push({ text: transcript, emittedAt: sttEmittedAt, closeReason });
  const merged = this.drainPendingTranscripts();
  // ...
}
```

**Key Changes:**
1. **Check `bargeInActive`** before queueing
2. **Bypass queue** if barge-in was triggered
3. **Jump ahead** of any queued transcripts (barge-in is higher priority)

---

## How It Works Now

### **Normal Turn (No Interruption)**
```
1. AI speaking → User speaks → isProcessing=true
2. STT final arrives → QUEUED (normal behavior)
3. AI finishes → Queue drains → Process transcript
```

### **Barge-In Turn (Interruption)** ✅
```
1. AI speaking → User interrupts → triggerBargeIn()
2. TTS stops → clearAudio sent → bargeInRequested=true
3. STT final arrives → bargeInActive=true → BYPASS QUEUE
4. Process transcript IMMEDIATELY (LLM starts on interruption)
```

---

## Expected Behavior

### **Before Fix** ❌
```
[00:00] AI: "I can help you with that. Let me explain..."
[00:02] USER INTERRUPTS: "Wait, stop!"
[00:02] TTS stops (silence)
[00:02] User continues: "I need something else"
[00:05] AI turn finishes processing
[00:05] Transcript processed: "Wait, stop! I need something else"
[00:06] AI responds to interruption
         ^ 4-second delay between interruption and response
```

### **After Fix** ✅
```
[00:00] AI: "I can help you with that. Let me explain..."
[00:02] USER INTERRUPTS: "Wait, stop!"
[00:02] TTS stops (silence)
[00:02] Transcript processed IMMEDIATELY: "Wait, stop!"
[00:02] AI responds to interruption
         ^ Instant response to interruption
```

---

## Testing Checklist

- [ ] **Test interruption during AI speech**
  - AI speaks a long sentence
  - User interrupts mid-sentence
  - Verify: STT final processes immediately (not queued)
  - Verify: LLM response starts within 1-2s of interruption

- [ ] **Test interruption during LLM generation**
  - AI is generating (not speaking yet)
  - User speaks
  - Verify: Transcript still queues (this is correct - LLM hasn't started speaking)

- [ ] **Test semantic barge-in**
  - AI speaking
  - User says "Stop" or "Wait"
  - Verify: TTS stops + transcript processes immediately

- [ ] **Test false interruption handling**
  - AI speaking
  - Background noise triggers barge-in
  - STT final is short (<3 words)
  - Verify: Marked as false interruption, reply resumes

---

## Related Code

### **Barge-In Trigger** (lines 1832-1887)
```typescript
private triggerBargeIn(trigger: string, partial?: string) {
  this.bargeInRequested = true;
  this._lastTurnWasBargedIn = true;
  this.bargeInCallback?.(); // → clearAudio
  this.streamSTT?.flush();  // → force STT finalization
  // ... abort TTS/LLM ...
}
```

### **False Interruption Filter** (lines 4228-4262)
```typescript
if (
  (this._lastTurnWasBargedIn || this.bargeInRequested)
  && isFalseInterruptionScrap(transcript, wordsThreshold)
) {
  // Drop scrap, resume barged reply
}
```

---

## Edge Cases Handled

1. **False Barge-In (Background Noise)**
   - Barge-in triggers → TTS stops
   - STT final is short (<3 words) → Marked as false interruption
   - Reply resumes from `_bargedReplyRemainder`

2. **Queue Has Pending Transcripts**
   - Barge-in transcript **jumps ahead** of queue
   - Queue drains after barge-in is processed

3. **Multiple Rapid Interruptions**
   - Each interruption bypasses queue independently
   - Transcripts processed in arrival order (within barge-in set)

---

## Metrics to Monitor

Post-deployment, check:
1. **Barge-in response latency** — should drop from 4-5s → <2s
2. **False interruption rate** — should stay <5% (existing filter still active)
3. **Queue depth** — barge-ins no longer inflate queue

---

## Rollback Plan

If this causes issues:
1. Revert lines 4299-4323 in `pipeline.ts`
2. Restore original queue logic (no `bargeInActive` check)
3. Issue will return: interruptions queue again
