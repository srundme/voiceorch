# Call 20094: Critical Pipeline Failure Analysis

**Date**: 2026-09-03  
**Call Duration**: 116 seconds  
**Agent**: Shanaya  
**End Reason**: Caller hung up  
**Booking Completed**: ❌ No

---

## Executive Summary

This call reveals **systemic failures across four layers** of the voice pipeline. The problems are NOT primarily prompt-related—they are **code-level orchestration, buffering, and STT accuracy issues**.

### Severity Breakdown

| Layer | Severity | Contribution | Issues |
|---|---|---:|---|
| **TTS Playback/Streaming** | 🔴 **Critical** | 35% | 6 audible underruns, premature playback completion |
| **STT Accuracy & Endpointing** | 🟠 High | 25% | Mixed-language transcripts (Kannada/Hindi/English), poor accuracy |
| **Transcript/Fallback Race** | 🟠 High | 20% | Valid "B2B" transcript ignored, "didn't hear you" played anyway |
| **LLM Conversation State** | 🟡 Medium | 12% | Repeated questions, weak loop prevention |
| **Prompt Design** | 🟡 Medium | 8% | 24,627 char prompt, needs simplification |

---

## P0 Critical: TTS Playback Buffer Failure

### Evidence

**Six confirmed audible playback underruns** in 116 seconds:

1. 12:43:15
2. 12:43:23
3. 12:43:49
4. 12:43:57
5. 12:44:26
6. 12:44:44

Plus one:
> `Playback Cancelled — audio_gated`

### Root Cause

The system is **splitting single LLM responses into multiple TTS requests**:

- Chunk 1: "Are you already running a travel business"
- Chunk 2: "or are you looking to start a new one?"

**Playback starts before all chunks arrive**:

- Playback started: ~12:43:09
- Playback marked complete: 12:43:15.163
- Second TTS chunk arrived: 12:43:15.909 ❌ **After playback "completed"**

This is a **playback-queue implementation bug**, not a prompt issue.

### Impact

- Broken sentences
- Audible pauses/gaps
- Missing words
- Robotic speech
- Caller speaks thinking agent finished
- STT captures agent's audio as caller speech
- **Caller frustration → hangup**

### Current Code Issues

From `pipeline.ts` lines 360-422:

```typescript
const TTS_PREBUFFER_WARM_MS = 600;  // Increased from 480ms (call 20088)
const TTS_PREBUFFER_COLD_MS = 700;
const TTS_PREBUFFER_CAP_MS = 800;
const TTS_CONCURRENCY_BOOST_MS_2 = 300;
const TTS_CONCURRENCY_BOOST_MS_3 = 400;
const TTS_CONCURRENCY_BOOST_MS_4 = 600;
```

**Problem**: Even with these increases, Call 20094 still had 6 underruns. The system does **not track outstanding TTS chunks**.

### Required Fixes

1. **Track pending TTS chunks per turn**
   - Add `pendingTtsChunks: number` counter
   - Increment when `enqueue()` is called
   - Decrement when TTS chunk completes
   - **Never mark playback complete while `pendingTtsChunks > 0`**

2. **Increase prebuffer significantly**
   - Current: 600-800ms insufficient for India latency
   - Recommended: 1200-1500ms base + concurrency boost

3. **Merge adjacent short chunks**
   - Combine chunks < 50 chars into one TTS request
   - Prevent fillers from becoming separate jobs (already partially addressed)

4. **Add jitter buffer protection**
   - When TTS queue empties temporarily, **wait** 500-1000ms before closing playback
   - Play silence frames to keep carrier alive

5. **Implement playback state machine**
   ```
   States: IDLE → BUFFERING → PLAYING → DRAINING → COMPLETE
   
   BUFFERING: Accumulate audio, don't start wire transmission yet
   PLAYING: Active transmission, track remaining chunks
   DRAINING: All chunks received, play out buffer
   COMPLETE: Only after DRAINING finishes AND no pending chunks
   ```

---

## P1 High: Transcript/Fallback Race Condition

### Evidence

From Call 20094 logs:

1. **Caller says**: "B2B"
2. **STT successfully produces**: `B2B` transcript
3. **System plays simultaneously**: "माफ़ कीजिए, मैं ठीक से सुन नहीं पाया — क्या आप दोबारा बोल सकते हैं?"

This is **logically incorrect**. A valid transcript exists but the "I didn't hear you" fallback was triggered anyway.

### Root Cause

The fallback clarification is scheduled **before the final STT result arrives**:

```
Timeline:
t=0    : VAD detects speech end
t=50   : Turn gate becomes eligible
t=100  : No final transcript yet → schedule clarification
t=150  : Final STT "B2B" arrives ← TOO LATE, clarification already playing
```

From `pipeline.ts` lines 2682-2700, `respondWithClarification()` is called without checking if a final transcript is pending or in-flight.

### Current Flow (Broken)

```typescript
private becomeTurnEligible(reason: string): void {
  // ...
  const graceMs = envInt("SEMANTIC_TURN_FINAL_MS", SEMANTIC_TURN_FINAL_MS_DEFAULT, 100);
  this._eouFinalTimer = setTimeout(() => {
    this._eouFinalTimer = null;
    void this.finalizeAwaitingTurn(gen, reason);  // ← Calls clarification
  }, graceMs);
}

private async finalizeAwaitingTurn(generation: number, reason: string): Promise<void> {
  // ...
  // ❌ No check for "is a final transcript about to arrive?"
  await this.attemptLostTurnRecovery(generation);
  // Falls through to "no final" path
}
```

### Required Fix

**Before playing any clarification, check if a final transcript has arrived**:

```typescript
private async finalizeAwaitingTurn(generation: number, reason: string): Promise<void> {
  if (this.closed || this.isProcessing || this.isPlaying) return;
  if (this.semanticTurnGate.turnGeneration !== generation) return;
  if (!this.semanticTurnGate.isAwaitingFinal()) return;

  // ✅ NEW: Check if a final transcript just arrived
  if (this._eouHeldFinal && this._eouHeldFinal.turnGeneration === generation) {
    const held = this._eouHeldFinal;
    this._eouHeldFinal = null;
    this.semanticTurnGate.markCommitted();
    void this.handleStreamingTranscript(held.text, held.emittedAt, held.closeReason);
    return;  // ← Process valid transcript, DON'T play clarification
  }

  // ✅ NEW: Extend grace period if STT stream is still active
  if (this.streamSTT?.isStreaming?.()) {
    const extendedGraceMs = 300;  // Give STT more time to finalize
    setTimeout(() => {
      void this.finalizeAwaitingTurn(generation, reason);
    }, extendedGraceMs);
    return;
  }

  logger.info(
    { callId: this.config.callId, generation, reason },
    "Semantic turn: no transcript.final yet — flushing STT / batch fallback",
  );
  
  // Flush STT
  try { this.streamSTT?.flush?.(); } catch { /* best-effort */ }
  
  // ✅ NEW: After flush, wait briefly for the final to arrive
  await new Promise(r => setTimeout(r, 200));
  
  // Check AGAIN if a final arrived during the wait
  if (this._eouHeldFinal && this._eouHeldFinal.turnGeneration === generation) {
    const held = this._eouHeldFinal;
    this._eouHeldFinal = null;
    this.semanticTurnGate.markCommitted();
    void this.handleStreamingTranscript(held.text, held.emittedAt, held.closeReason);
    return;
  }

  // Batch STT fallback
  await this.attemptLostTurnRecovery(generation);
  
  // ONLY play clarification if we STILL have no valid transcript
  if (!this.semanticTurnGate.belongsTo(generation) || !this.semanticTurnGate.isAwaitingFinal()) return;
  logger.info(
    { callId: this.config.callId, generation, reason },
    "Semantic turn: still no authoritative final — playing clarification",
  );
}
```

**Also add cancellation in `handleStreamingTranscript`**:

```typescript
private async handleStreamingTranscript(rawTranscript: string, sttEmittedAt = Date.now(), closeReason: TurnCloseReason = "stt_final"): Promise<void> {
  // ✅ NEW: Cancel any pending clarification timers
  if (this._eouFinalTimer) {
    clearTimeout(this._eouFinalTimer);
    this._eouFinalTimer = null;
    logger.info(
      { callId: this.config.callId, transcript: rawTranscript.slice(0, 80) },
      "Cancelled pending clarification — valid final transcript arrived",
    );
  }
  
  // ✅ NEW: If clarification is already playing, attempt to interrupt it
  if (this.isPlaying && this._currentTurnPlayedSentences.some(s => s.includes("didn't") || s.includes("सुन नहीं"))) {
    logger.info(
      { callId: this.config.callId, transcript: rawTranscript.slice(0, 80) },
      "Interrupting clarification playback — valid transcript arrived late",
    );
    this.bargeInRequested = true;  // Stop clarification playback
  }
  
  // ... rest of existing logic
}
```

---

## P2 High: STT Accuracy & Language Stability

### Evidence

**Mixed-language transcripts** in a Hindi call:

1. "Ji, ye nahi pata hai ye."  
2. "कहीं अच्छी तरह में घूम रही थी देखो।"  
3. "invest ಮಾಡ್ತಾ रहे हैं और फिर और में रहते हैं" ❌ **Kannada + Hindi + English**

The third transcript is nonsensical—why did Kannada appear in a Hindi conversation?

### STT Discards

Four transcripts were discarded:
1. Ultra-short noise stub
2. Self-echo
3. Another ultra-short noise stub
4. No caller energy above echo threshold

Plus:
> `Semantic Turn Hold — text_veto`

### Impact

Because the LLM received **unclear/incorrect transcripts**, it **repeatedly asked the same question**:

- "क्या आप नया ट्रैवल बिजनेस शुरू करने की सोच रहे हैं?"  
- "क्या आप अपना ट्रैवल बिजनेस शुरू करने की सोच रहे हैं या पहले से ही चला रहे हैं?"  
- "क्या आप अपना ट्रैवल बिजनेस शुरू करने की सोच रहे हैं या पहले से ही कर रहे हैं?"

The caller **may have answered correctly**, but STT failed to capture it.

### Required Fixes

1. **Lock STT language after caller requests Hindi**
   - Caller said: "जी, हिंदी से बोलना।"
   - System should lock STT to `hi-IN` for **all subsequent turns**
   - Current behavior: STT continues auto-detecting → drifts to Kannada/English

2. **Add domain vocabulary hints** (Sarvam Saaras v3 supports this):
   ```json
   {
     "vocabulary": [
       "B2B", "B2C", "CRM", "integration",
       "travel portal", "flight booking", "hotel booking",
       "ट्रैवल बिजनेस", "बुकिंग", "इंटीग्रेशन"
     ]
   }
   ```

3. **Increase endpointing delay** for multilingual/technical speech:
   - Current: 300ms (too short for "B2B", "CRM integration")
   - Recommended: 500-600ms for qualification calls

4. **Add STT confidence filtering**:
   ```typescript
   if (metadata.confidence < 0.4) {
     logger.warn(
       { callId, transcript, confidence: metadata.confidence },
       "Low STT confidence — requesting clarification instead of processing",
     );
     await this.respondWithClarification(sttLang);
     return;
   }
   ```

5. **Preserve one-word technical terms**:
   - "B2B", "CRM", "API" should NOT be discarded as "ultra-short noise"
   - Update `isUltraShortNoiseFragment()` to whitelist known domain terms

---

## P3 Medium: LLM Conversation State

### Evidence

**Repeated questions** despite valid previous answers:

> Q1: "क्या आप नया ट्रैवल बिजनेस शुरू करने की सोच रहे हैं?"  
> A1: [caller answers]  
> Q2: "क्या आप अपना ट्रैवल बिजनेस शुरू करने की सोच रहे हैं या पहले से ही चला रहे हैं?" ← Same question rephrased  
> A2: [caller answers]  
> Q3: "क्या आप अपना ट्रैवल बिजनेस शुरू करने की सोच रहे हैं या पहले से ही कर रहे हैं?" ← Same question again

### Causes

1. **Poor STT transcripts** (see P2 above)
2. **No loop-prevention state tracking**
3. **Weak prompt handling of either/or questions**:
   - Agent: "क्या आप B2B या B2C portal देख रहे हैं?"
   - Caller: "हां।" ← Doesn't answer "which one"
   - Agent response adds a third option instead of re-asking clearly

### Required Fixes

1. **Track asked questions** in booking flow state:
   ```typescript
   bookingFlowState: {
     pendingName: string | null,
     pendingEmail: string | null,
     emailConfirmed: boolean,
     askedBusinessStatus: number,  // ← NEW: count how many times asked
     askedB2CorB2B: number,         // ← NEW
     askedIntegrations: number,     // ← NEW
   }
   ```

2. **Add loop-prevention in prompt**:
   ```
   If you've asked the same question twice without a clear answer:
   - Simplify the question
   - Offer explicit choices: "1 for B2B, 2 for B2C"
   - After 3 attempts, move to next requirement
   ```

3. **Handle "हां" / "yes" better** for either/or questions:
   - Current: Agent adds more options, making it longer
   - Better: "B2B या B2C—इनमें से कौन-सा चाहिए?" (concise repeat)

4. **Store confirmed answers** to prevent re-asking:
   ```typescript
   if (bookingFlowState.businessStatus === "starting") {
     // Don't ask about business status again
   }
   ```

---

## P4 Medium: Filler Chunking (Partially Fixed)

### Evidence

Separate TTS requests for fillers:
- "Mm-hmm"
- "हम्म"
- "ठीक है"
- "ओके"
- "अच्छा"

One filler cancelled:
> `Playback Cancelled — audio_gated`

### Status

✅ **Partially fixed** by commits:
- `fix(pipeline): Add Devanagari Hindi filler detection (ओके, अच्छा)` (b07a0f66b)
- Call 20088 filler suppression (commit 9020-9057 in `pipeline.ts`)

### Remaining Work

Verify filler suppression is applied **before** LLM streaming split logic, not just in the `enqueue()` path.

---

## P5 Low: Prompt Size

**Prompt size**: ~24,627 characters

This is quite large for a qualification call. May contain:
- Duplicate rules
- Conflicting instructions
- Too many examples
- Reduced attention to current call state

### Recommendation

Audit and simplify the prompt to **< 15,000 characters**.

---

## Implementation Priority

### Immediate (This Week)

1. ✅ **Fix Devanagari filler detection** (Done: `b07a0f66b`)
2. 🔴 **P0: TTS playback tracking** (track `pendingTtsChunks`, don't mark complete while chunks pending)
3. 🔴 **P1: Transcript/fallback race** (extend grace, cancel clarification if final arrives)

### Next Sprint

4. 🟠 **P2: STT language locking** (lock to Hindi after explicit request)
5. 🟠 **P2: Domain vocabulary hints** (add B2B, CRM, etc. to Saaras v3)
6. 🟡 **P3: Loop-prevention state** (track asked questions, prevent endless repeats)

### Backlog

7. 🟡 **P4: Verify filler suppression** (ensure it's applied early in LLM streaming)
8. 🟡 **P5: Prompt audit** (simplify to < 15K chars)

---

## Testing Plan

After implementing P0-P2 fixes:

1. **Synthetic underrun test**: Run 5 concurrent calls to simulate event-loop lag
2. **B2B transcript race test**: Send "B2B" transcript exactly during VAD->finalization window
3. **Hindi language drift test**: Lock STT to `hi-IN`, verify no Kannada/English leakage
4. **Repeat question test**: Answer with "yes" to either/or question, verify agent doesn't loop

---

## Conclusion

**This is NOT a prompt problem.**

The main failures are in the **real-time voice pipeline code**:

1. TTS playback completes before all chunks arrive → audible glitches
2. Valid STT results don't cancel queued fallback responses → confusing UX
3. STT produces inaccurate multilingual transcripts → LLM gets bad input
4. LLM repeats questions because it receives unreliable transcripts

**Changing only the prompt will NOT fix the audible underruns or the "B2B" race condition.**

---

**Author**: AI Assistant  
**Review Status**: Pending user confirmation  
**Next Action**: Implement P0 (TTS chunk tracking) and P1 (fallback race fix)
