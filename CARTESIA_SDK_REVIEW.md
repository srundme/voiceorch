# Cartesia SDK Migration Review

**Date:** 2026-09-03  
**Status:** Raw WebSocket (Keep)  
**Recommendation:** Stay on raw WebSocket

---

## Current Implementation

We use **raw WebSocket** (`ws` package) with custom logic:

### **Custom Features**
1. **WebSocket → REST Fallback** (lines 280-290)
   - On WS handshake failure, switch to REST for the entire call
   - Prevents double-speak by checking if WS already delivered audio

2. **Turn-Level Context Management** (lines 630-1000)
   - One persistent WS context per LLM turn (multiple sentences)
   - First sentence owns the context, later sentences join via `continue:true`
   - When `max_buffer_delay_ms=0`, Cartesia closes context after first clip → leftover sentences fall back to REST
   - Complex state tracking: `claimTurnContext`, `finalizeTurnContext`, `waitFirstClipComplete`, `leftoverPending`

3. **Emotion Control Retry** (lines 70-80, 146-150, 1140-1150)
   - If Cartesia rejects emotion controls (400 "invalid emotion"), retry once without emotion
   - Prevents call failure for single sentence styling issues

4. **Custom Timeouts**
   - WS connect: 6s (line 34)
   - First clip quiet detection: 400ms (line 92)

5. **Manual Flush & Context Tracking**
   - `flushPending` map (line 195) for turn-level manual flush tracking
   - Per-turn flush counters, chunk handlers, transcript joining

---

## Official Cartesia SDK (`@cartesia/cartesia-js` v3.5.1+)

### **What the SDK Provides**
- ✅ **WebSocket Reconnection:** 5 retries, 500-8000ms backoff, message queuing
- ✅ **REST Retries:** 2x for 408/409/429/5xx, exponential backoff
- ✅ **Configurable Timeouts:** Default 60s
- ✅ **Voice/Model Management:** Built-in validation and aliasing

### **What the SDK DOESN'T Provide**
- ❌ **Turn-Level Context Management:** SDK exposes per-sentence `context_id`, but our orchestration (first sentence WS → later sentences REST) is custom business logic
- ❌ **Emotion Control Retry:** No built-in retry for `invalid emotion` errors
- ❌ **WS → REST Fallback After First Clip:** Our `max_buffer_delay_ms=0` workaround is specific to our use case

---

## Why We Can't Use the SDK

### **1. Turn-Level Context Orchestration**
Our pipeline sends **multiple sentences per LLM turn** with complex logic:
- **First sentence:** Opens WS context (`continue:false`)
- **Later sentences:** Join context (`continue:true`)
- **When Cartesia closes context after first clip** (call 19809): Leftover sentences fall back to REST

**SDK limitation:** Cartesia's SDK is designed for **one-shot synthesis** (one sentence = one request). It doesn't expose:
- Turn-level context lifecycle (`claimTurnContext`, `finalizeTurnContext`)
- First-clip-done detection (`markFirstClipDone`, `waitFirstClipComplete`)
- Leftover REST queueing (`leftoverPending`, `enqueueLeftoverRest`)

### **2. Custom WS → REST Fallback Strategy**
Our fallback is **per-call**, not per-request:
- If WS handshake fails, the **entire call** switches to REST (line 276: `markWsFailed`)
- We check if WS already delivered audio before falling back to REST (line 292-307: `restIfSilent`)

**SDK limitation:** SDK retries are **per-request** (each synthesis call is independent). Our stateful per-call fallback requires custom logic.

### **3. Emotion Control Backward Compatibility**
We accept **legacy emotion arrays** (`["positivity:high"]`) and map them to current enum values (lines 125-138: `normalizeEmotion`)

**SDK limitation:** SDK expects the current API format only.

---

## Migration Effort Estimate

To use the SDK, we'd need to:
1. **Rewrite turn-level context logic** (~500 lines, high risk)
2. **Replace custom WS fallback** with SDK retries (~200 lines)
3. **Test all edge cases:**
   - Call 19809 (Cartesia closes context after first clip)
   - Call 17873 (WS handshake timeout → REST fallback)
   - Emotion control rejection → retry without emotion
   - Barge-in mid-turn (leftover sentences must not double-speak)

**Estimated effort:** 2-3 days + extensive live call testing  
**Risk:** High (turn-level orchestration is critical for call quality)

---

## Recommendation: **Keep Raw WebSocket**

### **Why?**
1. **Our logic is not redundant** — it's custom business logic the SDK doesn't support
2. **Low maintenance burden** — our implementation is stable (no recent issues)
3. **High migration risk** — rewriting turn context orchestration could introduce new bugs

### **What We're Duplicating from the SDK**
- **Retry logic:** Our 2 retries (line 31, 142-155) vs. SDK's 2 retries
  - **Impact:** Negligible — both retry 2x with backoff
- **Timeout:** Our 6s WS connect (line 34) vs. SDK's 60s default
  - **Impact:** Our shorter timeout is intentional (fail fast for REST fallback)

---

## Action Items

- [x] **Document why we use raw WebSocket** (this document)
- [ ] **Review quarterly** — check if Cartesia SDK adds turn-level context support
- [ ] **Monitor SDK releases** — if Cartesia adds `continue:true` context management, re-evaluate

---

## Comparison Table

| Feature | Our Implementation | Cartesia SDK | Winner |
|---------|-------------------|--------------|--------|
| **Turn-level context management** | ✅ Full support | ❌ Not exposed | **Ours** |
| **WS → REST fallback (per-call)** | ✅ Stateful | ❌ Per-request only | **Ours** |
| **Emotion control retry** | ✅ Legacy compat | ❌ Current API only | **Ours** |
| **WebSocket reconnection** | ❌ No auto-reconnect | ✅ 5 retries + queue | **SDK** |
| **REST retry** | ✅ 2 retries | ✅ 2 retries | **Tie** |
| **Connect timeout** | ✅ 6s (fail fast) | ✅ 60s (default) | **Depends** |

---

## Verdict

**Stay on raw WebSocket.** Our custom logic is **not redundant** — it's essential orchestration that the SDK doesn't support. The migration cost is high, and the benefits are minimal (we're only duplicating basic retry logic).

Re-evaluate if:
1. Cartesia SDK adds `continue:true` context lifecycle management
2. We simplify to one-sentence-per-turn (eliminating turn context logic)
3. We encounter WebSocket reconnection issues that the SDK's auto-reconnect would solve
