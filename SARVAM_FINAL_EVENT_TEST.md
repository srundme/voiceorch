# Sarvam TTS Final Event Reliability Test

**Date:** 2026-09-03  
**Status:** Workaround Active (Testing Required)  
**Bug Status:** 🟢 **FIXED** by Sarvam (confirmed in PipeCat v0.0.106, 2025-11-04)

---

## Current Implementation

### **Workaround: `FINAL_EVENT_IDLE_MS` (2500ms)**
**File:** `artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts:33-34, 609-621`

```typescript
const FINAL_EVENT_IDLE_MS = Math.max(1500, Number(process.env.SARVAM_TTS_FINAL_IDLE_MS ?? 2500));

// In synthesizeViaWs():
let idleTimer: NodeJS.Timeout | null = null;
const armIdle = () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    settle(() => {
      logger.warn({ textLen: text.length }, "SarvamTTS WS final-event idle backstop — resolving without final");
      try { ws.close(1000, "final-idle"); } catch { /* ignore */ }
      resolve();
    });
  }, FINAL_EVENT_IDLE_MS);
};
```

### **How It Works**
1. After sending `flush` message, arm idle timer (2500ms)
2. Every incoming message (audio/event/error) re-arms the timer
3. If WebSocket goes **fully idle** for 2500ms after flush:
   - Assume `final` event was lost
   - Resolve the promise (treat synthesis as complete)
   - Close socket with code 1000

### **Why We Added It**
- **Symptom:** Without this, promise hangs until 8s stream timeout
- **Caller experience:** Silence mid-sentence, then TTS rebuffer-loops
- **Logs:** `"SarvamTTS WS final-event idle backstop — resolving without final"`

---

## Provider's Bug Fix

### **Sarvam's Official Status** (via PipeCat)
- **Bug:** `final` event never arrives → delayed `BotStoppedSpeakingFrame` (>8s lag)
- **Fix:** [PipeCat PR #4639](https://github.com/pipecat-ai/pipecat/pull/4639) (merged 2025-11-04)
- **Verified By:** PipeCat maintainers (live tests with `examples/voice/voice-sarvam.py`)

### **What Changed**
1. **`send_completion_event=true` now works reliably** (we already use this: line 385)
2. **`{"type": "event", "data": {"event_type": "final"}}` arrives immediately** after synthesis completes
3. **PipeCat removed their idle timer workaround** after confirming the fix

### **Our Implementation**
✅ We request `send_completion_event=true` (line 385):
```typescript
url.searchParams.set("send_completion_event", "true");
```

✅ We handle the `final` event (lines 643-650):
```typescript
if (msg.type === "event") {
  if (msg.data?.["event_type"] === "final") {
    settle(() => {
      this.parkWarmWs(ws); // keep connection for next sentence
      resolve();
    });
  }
  return;
}
```

---

## Test Plan

### **Goal**
Verify that `final` event arrives reliably on production calls, making `FINAL_EVENT_IDLE_MS` workaround unnecessary.

### **Test Scenarios**

#### **1. Normal Sentences (3-10 words)**
- **Expected:** `final` event arrives 100-300ms after last audio chunk
- **Workaround should NOT trigger:** No `"final-event idle backstop"` logs

#### **2. Long Sentences (50+ words)**
- **Expected:** `final` event still arrives immediately after last audio
- **Workaround should NOT trigger:** Idle timer re-armed by continuous audio chunks

#### **3. Short Sentences (1-2 words)**
- **Expected:** `final` event arrives even for tiny audio clips
- **Workaround should NOT trigger:** Minimum synthesis time < 2500ms

#### **4. Rapid Barge-ins**
- **Expected:** Socket closes with code 1000 ("barge-in"), not 1000 ("final-idle")
- **Workaround is irrelevant:** Abort happens before flush

#### **5. Network Delays**
- **Expected:** If audio chunks are slow (>2500ms gap), workaround MAY trigger
- **Acceptable:** Workaround is still valid as a safety net for extreme latency

### **Data to Collect**

From production logs, count:
1. **Total Sarvam TTS synthesis calls**
2. **`final` event arrivals** (line 646: `"event_type": "final"`)
3. **Workaround triggers** (line 616: `"SarvamTTS WS final-event idle backstop"`)

**Success criteria:** Workaround triggers <1% of calls (or only during network issues)

---

## Test Execution

### **Phase 1: Production Monitoring (7 days)**
1. Deploy current code (workaround active)
2. Grep logs for `"final-event idle backstop"` vs. `event_type=final`
3. Analyze call_ids where workaround triggered:
   - Was it a genuine final-event miss?
   - Or was it extreme network latency (audio chunks >2500ms apart)?

### **Phase 2: Reduce Idle Timeout (A/B Test)**
1. Lower `FINAL_EVENT_IDLE_MS` to 1500ms (via env var)
2. Monitor for increased workaround triggers
3. If workaround triggers remain low (<1%), proceed to Phase 3

### **Phase 3: Remove Workaround (Canary)**
1. Remove idle timer logic (lines 610-621)
2. Deploy to 10% of traffic
3. Monitor for:
   - Stuck synthesis (promises never resolve)
   - 8s TTS stream timeouts
   - Caller hears silence mid-sentence

### **Phase 4: Full Rollout**
1. If canary shows no issues, deploy to 100%
2. Remove `FINAL_EVENT_IDLE_MS` constant and env var
3. Update comments (lines 605-610) to: *"Sarvam's final event is now reliable (fixed 2025-11-04)"*

---

## Expected Outcome

### **If Final Event is Reliable**
- ✅ Remove lines 610-621 (idle timer logic)
- ✅ Remove `FINAL_EVENT_IDLE_MS` constant (line 33)
- ✅ Update comment (line 605) to reflect fix
- ✅ Report success to Sarvam support (positive feedback)

### **If Final Event is Still Broken**
- ❌ Keep workaround active
- ❌ Report to Sarvam with:
  - Call IDs where `final` was missing
  - Sentence text and length
  - Audio generation time
  - Network latency metrics
- ❌ Request ETA for permanent fix

---

## Rollback Plan

If removing workaround causes issues:
1. **Immediate:** Re-deploy with idle timer active
2. **Restore env var:** `SARVAM_TTS_FINAL_IDLE_MS=2500`
3. **Log analysis:** Determine if issue is Sarvam's API or network latency

---

## Action Items

- [ ] **Phase 1:** 7-day production monitoring (count workaround triggers)
- [ ] **Phase 2:** A/B test with 1500ms timeout (if Phase 1 shows <1% triggers)
- [ ] **Phase 3:** Canary deployment without workaround (10% traffic)
- [ ] **Phase 4:** Full rollout if canary succeeds
- [ ] **Report to Sarvam:** Send success/failure data to support

---

## References

- **PipeCat Fix:** [PR #4639](https://github.com/pipecat-ai/pipecat/pull/4639) (2025-11-04)
- **PipeCat Issue:** [#4638](https://github.com/pipecat-ai/pipecat/issues/4638) ("Sarvam TTS Bot stopped speaking is late")
- **Sarvam Docs:** [WebSocket Best Practices](https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/streaming-api/web-socket)

---

## Decision Log

| Date | Action | Outcome |
|------|--------|---------|
| 2026-09-03 | Created test plan | Workaround remains active pending monitoring |
| _TBD_ | Phase 1 monitoring complete | _Log analysis results_ |
| _TBD_ | Phase 3 canary deployment | _Success/rollback_ |
| _TBD_ | Final decision | _Remove workaround or keep_ |
