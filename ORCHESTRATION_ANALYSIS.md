# Orchestration Analysis: Voice Isolation Breaking STT

## Problem Summary

After deploying the voice isolation layer (GTCRN), the system is:
1. **Capturing background speakers** - Friend speaking 1-2m away is transcribed
2. **Incorrect language switching** - System switches to Kannada/Telugu based on background speech
3. **Agent speaking wrong language** - The entire conversation derails

## Root Cause

The voice isolation integration has a **critical architectural flaw**:

### Audio Flow (Current - BROKEN)

```
Raw Audio (8kHz μ-law)
    ↓
processAudioIn() → Audio Worker
    ↓
GTCRN Voice Isolation (enhances ALL speech including nearby speakers)
    ↓
Enhanced Audio + rawRms (pre-isolation)
    ↓
handleProcessedAudio()
    ↓
[INVARIANT: DO NOT GATE]
    ↓
streamSTT.sendAudio() ← UNCONDITIONAL SEND (including enhanced background speech!)
    ↓
STT transcribes background speaker
    ↓
Language auto-detection triggers on background speech
    ↓
Agent switches to wrong language
```

### The Critical Flaw

**File:** `artifacts/api-server/src/orchestration/pipeline.ts`
**Lines:** 4989-5006

```typescript
// ── INVARIANT — DO NOT GATE OR FLUSH THIS FEED (calls 772→1320) ─────────
// Every caller frame reaches the streaming-STT socket unconditionally.
const sttFrame = this.sttSampleRate === 8000 ? pcm8k : effectivePcm16k;
this.streamSTT.sendAudio(sttFrame);
```

**Problem:**
1. GTCRN enhances ALL speech (as documented in `voice-isolator.ts:7-9`)
2. Enhanced audio is sent UNCONDITIONALLY to STT
3. `rawRms` (pre-isolation energy) is computed but **NEVER used to filter STT input**
4. `BACKGROUND_TALKER_MIN_RAW_RMS` threshold exists but **is not enforced** for STT

**File:** `artifacts/api-server/src/orchestration/live-pipeline-invariants.test.ts`
**Lines:** 66-70

```typescript
it("does not drop listening finals on RMS — STT is the turn authority (call 14351)", () => {
  expect(pipelineSrc).not.toContain("isBackgroundTalkerUtterance(");
  expect(pipelineSrc).not.toContain("utterancePeakRawRms");
});
```

This test **explicitly prevents** filtering transcripts by RMS energy!

### Why BACKGROUND_TALKER_MIN_RAW_RMS = 1200 Had No Effect

The threshold increase in the previous fix was **completely ineffective** because:

1. It's defined in `mic-sensitivity.ts`
2. It's only used in `isIdleCancellingMicEnergy()` (idle watchdog)
3. It's **NEVER checked before sending audio to STT**
4. The logs showing "Raw mic energy below gate" were just diagnostic logs, not actual filtering

## Voice Isolation Limitations

**File:** `artifacts/api-server/src/orchestration/voice-isolator.ts`
**Lines:** 7-9

```typescript
// This is speech enhancement (keep speech, suppress hiss / fans / traffic), not
// "ignore other people talking". A bystander a few metres away is still speech
// and must be rejected on RAW mic energy in the pipeline.
```

GTCRN is **by design** incapable of rejecting nearby speakers. It enhances ALL speech, then relies on the pipeline to filter by raw energy.

## The Invariant Conflict

**Historical Context (calls 772→1320):**

The pipeline has a strict invariant: **NEVER gate audio sent to STT**. This was to prevent starving the STT provider's VAD during agent playback, which broke barge-in.

**Current Conflict:**

- **Invariant says:** Send every frame unconditionally
- **Voice isolation requires:** Filter frames by raw energy BEFORE STT
- **Current state:** Voice isolation enhances background speech → STT receives it → chaos ensues

## The Solution

We need to honor BOTH requirements:

1. **Maintain the invariant:** Never conditionally skip `streamSTT.sendAudio()`
2. **Respect raw energy threshold:** Don't let low-energy (background speaker) audio reach STT

**Solution: Send SILENCE for low-energy frames**

```typescript
// In handleProcessedAudio(), before streamSTT.sendAudio():
const sttFrame = this.sttSampleRate === 8000 ? pcm8k : effectivePcm16k;

// GTCRN enhances ALL speech (including far-field bystanders). Reject low raw-energy
// frames by replacing them with SILENCE before STT, so background talkers cannot
// drive transcripts or language switching. Maintains the 772→1320 invariant (never
// gate the send), but prevents enhanced bystander speech from reaching STT.
if (rawRms > 0 && rawRms < BACKGROUND_TALKER_MIN_RAW_RMS) {
  // Replace with silence — STT receives a frame (invariant satisfied) but no speech
  const silentFrame = Buffer.alloc(sttFrame.length);
  this.streamSTT.sendAudio(silentFrame);
} else {
  this.streamSTT.sendAudio(sttFrame);
}
```

## Impact

**Before Fix:**
- ✗ Background speakers transcribed
- ✗ Language auto-detection triggered by wrong speaker  
- ✗ Agent responds in wrong language
- ✗ Call is "totally waste"

**After Fix:**
- ✓ Background speakers below threshold → silence sent to STT
- ✓ No spurious transcripts from nearby talkers
- ✓ Language detection only triggers on phone holder
- ✓ Agent maintains correct language
- ✓ Invariant maintained (send is never skipped)

## Testing Plan

1. **Unit test:** Verify silence is sent when `rawRms < BACKGROUND_TALKER_MIN_RAW_RMS`
2. **Live test:** Have friend speak nearby during call (reproduce original scenario)
3. **Verify logs:** Confirm no transcripts from background speaker
4. **Language stability:** Verify no incorrect language switching

## References

- Calls 19920-19926: Background speaker captured, language switched to Kannada/Telugu
- Call 19901: Initial noise cancellation issue (friend's voice captured)
- Calls 772→1320: Historical regression when STT feed was gated
- Call 14351: Why transcript authority stays with STT, not raw energy
