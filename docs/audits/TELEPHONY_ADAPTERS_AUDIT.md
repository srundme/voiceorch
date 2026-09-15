# Telephony Adapters Audit (Vobiz, Twilio)

**Date:** 2026-09-03  
**Scope:** Apply "Provider Trust Policy" to telephony WebSocket handlers  
**Verdict:** ✅ **Clean** — No redundant logic, trust providers appropriately

---

## Core Principle

Telephony adapters should:
1. **Trust the provider's WebSocket protocol** (event flow, encoding, barge-in)
2. **Only add logic for:**
   - Session lifecycle (createSession, endSession)
   - Audio format conversion (mulaw ↔ PCM)
   - Call-specific features (early ambient, duplicate detection, transfer)

---

## Vobiz Adapter

**File:** `artifacts/api-server/src/orchestration/telephony/vobiz.ts`

### **What It Does** ✅
1. **Session Lifecycle** (lines 275-334)
   - `createSession` → `endSession`
   - Duplicate stream detection (lines 198-230)
   - Transfer support (lines 299-310)
   - Callback resumeContext loading (lines 255-272)

2. **Audio Handling** (lines 139-159)
   - **Outbound:** 8kHz LINEAR16 PCM → base64 → `playAudio` event
   - **Inbound:** base64 LINEAR16 PCM → Buffer → `pipeline.onRawPcm8kIn()`
   - **Barge-in:** `clearAudio` event (line 157)

3. **Early Ambient Keepalive** (lines 240-252)
   - Sends agent ambient audio during session setup
   - Prevents 2s silence timeout on Vobiz's audio bridge

### **What It DOESN'T Do** (Good!) ✅
- ❌ No retry logic (Vobiz manages WebSocket reconnection)
- ❌ No custom timeouts (trusts Vobiz's protocol)
- ❌ No audio format workarounds (LINEAR16 is passed directly)
- ❌ No confidence filtering (audio is raw PCM, not transcripts)

### **Vobiz-Specific Features** (Justified) ✅
1. **Duplicate Stream Detection** (lines 198-230)
   - **Why:** Vobiz's answer-webhook retry can open **two** media WebSockets for the same CallUUID
   - **Impact:** Prevents double-greeting (two agents speaking simultaneously)
   - **Assessment:** ✅ **Required** — not redundant, solves real Vobiz issue

2. **Early Ambient Keepalive** (lines 240-252)
   - **Why:** Vobiz drops call if audio bridge receives no data for ~2s (even with `keepCallAlive="true"`)
   - **Impact:** Caller hears agent ambient (not dead air) during session setup
   - **Assessment:** ✅ **Required** — workaround for Vobiz's aggressive silence detection

3. **Transfer Guard** (lines 299-310)
   - **Why:** Closing WS after transfer aborts the in-flight Transfer API call
   - **Impact:** Prevents transferred calls from hanging up mid-transfer
   - **Assessment:** ✅ **Required** — Vobiz-specific transfer race condition

---

## Twilio Adapter

**File:** `artifacts/api-server/src/orchestration/telephony/twilio.ts`

### **What It Does** ✅
1. **Session Lifecycle** (lines 126-174)
   - `createSession` → `endSession`
   - Callback resumeContext loading (lines 84-100)
   - Transfer support (lines 142-150)

2. **Audio Handling** (lines 54-61, 179-186)
   - **Outbound:** Buffer → base64 mulaw → `media` event
   - **Inbound:** base64 mulaw → Buffer → `pipeline.onAudioIn()`
   - **Barge-in:** `clear` event (lines 152-157)

3. **Early Ambient Keepalive** (lines 117-123)
   - Sends mulaw ambient audio during session setup
   - Prevents caller from hearing dead air

### **What It DOESN'T Do** (Good!) ✅
- ❌ No retry logic (Twilio manages WebSocket reconnection)
- ❌ No custom timeouts (trusts Twilio's protocol)
- ❌ No mulaw → PCM conversion workarounds (pipeline handles mulaw directly)
- ❌ No confidence filtering (audio is raw mulaw, not transcripts)

### **Twilio-Specific Features** (Justified) ✅
1. **Early Ambient Keepalive** (lines 117-123)
   - **Why:** Same as Vobiz — caller hears ambient during session setup
   - **Format:** Mulaw (Twilio) vs. LINEAR16 (Vobiz)
   - **Assessment:** ✅ **Required** — user experience improvement

2. **Transfer Guard** (lines 142-150)
   - **Why:** Same as Vobiz — prevents WS close from aborting transfer
   - **Assessment:** ✅ **Required** — Twilio-specific transfer race condition

---

## Common Patterns (Both Adapters)

### ✅ **Good Patterns**
1. **Session End Guard** (lines 315-320 Vobiz, 161-164 Twilio)
   - If `stop` event arrives before `createSession` completes → end session immediately
   - **Why:** Prevents stuck `in_progress` records
   - **Assessment:** ✅ **Required** — fixes race condition

2. **Transfer Guard** (both adapters)
   - Skip `ws.close()` if `wasTransferred=true`
   - **Why:** Provider is redirecting the call leg via Transfer API
   - **Assessment:** ✅ **Required** — prevents transfer abortion

3. **Early Ambient Keepalive** (both adapters)
   - Send ambient audio during session setup
   - **Why:** Caller doesn't hear dead air while DB/LLM initializes
   - **Assessment:** ✅ **UX feature** — not redundant

---

## What We're NOT Doing (Good!)

### ❌ **No Redundant Retry Logic**
- We don't retry WebSocket messages on failure
- We don't implement custom reconnection logic
- **Why:** Vobiz/Twilio manage WebSocket reliability internally

### ❌ **No Audio Format Workarounds**
- We don't resample or reencode audio
- Vobiz: LINEAR16 PCM passed directly to pipeline
- Twilio: Mulaw passed directly to pipeline
- **Why:** Providers deliver audio in the format we expect

### ❌ **No Custom Timeouts**
- We don't add timeouts on `createSession`
- We don't timeout WebSocket messages
- **Why:** Providers handle protocol-level timeouts

---

## Comparison to Provider Trust Policy

| Policy Guideline | Vobiz | Twilio | Compliant? |
|------------------|-------|--------|------------|
| Trust provider SDKs/protocols | ✅ Trust WS protocol | ✅ Trust WS protocol | ✅ |
| Only add logic for missing features | ✅ Duplicate detection | ✅ (none needed) | ✅ |
| Document workarounds with "why" | ✅ Comments on lines 198-230 | ✅ Comments on lines 117-123 | ✅ |
| Report bugs upstream | N/A (no bugs found) | N/A (no bugs found) | ✅ |
| No confidence filtering | ✅ Raw audio only | ✅ Raw audio only | ✅ |
| No retry if provider does it | ✅ No retry logic | ✅ No retry logic | ✅ |

---

## Action Items

- [x] Audit Vobiz adapter → **Clean** ✅
- [x] Audit Twilio adapter → **Clean** ✅
- [ ] Monitor Vobiz duplicate stream detection → ensure it's still needed (check if Vobiz fixed webhook retry behavior)
- [ ] Monitor early ambient keepalive → measure session setup latency (if <1s, consider removing)

---

## Verdict

### ✅ **Both Adapters Are Clean**

**No redundant logic found.** All custom features are:
1. **Justified** — solve real provider-specific issues (duplicate streams, silence timeouts)
2. **Documented** — inline comments explain "why"
3. **Minimal** — only add what's necessary for call quality

**No changes needed.** Continue following Provider Trust Policy.

---

## Optional Future Improvements

### **1. Duplicate Stream Detection (Vobiz)**
- **Current:** Custom logic (lines 198-230)
- **Check:** Has Vobiz fixed answer-webhook retry behavior?
- **If yes:** Remove duplicate detection logic
- **If no:** Keep (still required)

### **2. Early Ambient Keepalive (Both)**
- **Current:** Active for all calls
- **Optimize:** Only send if session setup >1s
- **Benefit:** Reduces unnecessary audio traffic on fast setups
- **Risk:** Low (ambient is <100KB per call)

---

## References

- **Vobiz Docs:** [AI Voice Agent Guide](https://docs.vobiz.ai/guides/ai-voice-agent)
- **Twilio Docs:** [Media Streams Protocol](https://www.twilio.com/docs/voice/twiml/stream#message-types)
- **Provider Trust Policy:** `PROVIDER_TRUST_POLICY.md`
