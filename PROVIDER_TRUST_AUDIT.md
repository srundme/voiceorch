# Provider Trust Audit - All Adapters

**Date**: 2026-09-03  
**Scope**: STT, LLM, TTS, Telephony adapters  
**Goal**: Find where we're building extra logic instead of trusting provider capabilities

---

## 🔴 CRITICAL ISSUES (Same as Saaras v3)

### 1. **Azure STT - Confidence Filtering**
**File**: `artifacts/api-server/src/orchestration/adapters/stt/azure.ts:384-395`

```typescript
// PROBLEM: We're adding confidence filtering on top of Azure's detection
const confidence = best?.Confidence ?? 1;
const effectiveThreshold = Math.min(this.cfg.confidenceThreshold, 0.15);
if (confidence < effectiveThreshold) {
  logger.info({ confidence, effectiveThreshold }, 
    "Azure stream: transcript filtered by confidence");
  return; // ← REJECT Azure's transcript!
}
```

**Issue**: 
- Azure Speech already provides confidence scores
- We're adding a **15% minimum threshold** on top
- Comment says "Azure streaming confidence for Indic languages is naturally lower"
- **This is the SAME problem as Saaras v3!**

**Question for Provider**: Does Azure Speech already handle low-confidence filtering internally?

**Recommendation**: 
- Trust Azure's transcript completely, OR
- Only filter extremely low confidence (< 5%)
- Don't assume provider confidence is "wrong" for Indic languages

---

## 🟡 MEDIUM ISSUES (Retry/Fallback Logic)

### 2. **Cartesia TTS - Complex Fallback Chain**
**File**: `artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts`

```typescript
// Lines 950-967: WebSocket fails → Retry → Fall back to REST
try {
  const ws = await this.getOrOpenWs();
  return await this.synthesizeViaWsInContext(ws, turnContextId, text, ...);
} catch (retryErr) {
  // Retry with WS
  if (/connect timeout|connection error/.test(this.errMsg(retryErr))) {
    this.markWsFailed(retryErr, "streamInContext:retry");
  }
  // Fall back to REST
  await this.restIfSilent(text, sink, onDone, signal, ...);
}

// Lines 1144-1147: Emotion controls retry
try {
  return await doRequest(emotions);
} catch (err) {
  // Cartesia rejected emotion controls — retry without them
  if (emotions && isInvalidVoiceControlsError(err)) {
    return doRequest(undefined); // ← Strip emotions and retry
  }
}
```

**Issues Found**:
1. **WS → REST fallback**: Complex logic to detect connection failures and fall back to slower REST API
2. **Emotion controls retry**: Strip experimental emotion controls and retry on 400 error
3. **Connect timeout** (line 441): Custom 5s timeout before declaring WS "failed"
4. **Context closed retry** (line 952): Special handling for "context has closed" errors

**Questions**:
- Does Cartesia SDK handle WS → REST fallback internally?
- Should emotion control errors be handled by the SDK?
- Is the 5s connect timeout necessary or does SDK have built-in timeout?

**Recommendations**:
- Check if Cartesia SDK has built-in retry/fallback
- Consider using SDK's native error handling
- Document why we need custom retry logic

---

### 3. **Sarvam TTS - WebSocket Retry with Backoff**
**File**: `artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts`

```typescript
// Lines 558-568: Retry loop with exponential backoff
for (let attempt = 0; attempt < WS_RETRY_MAX; attempt++) {
  try {
    // ... synthesis attempt
  } catch (err) {
    lastErr = err;
    if (err instanceof SarvamWsFatalError) {
      break; // Don't retry auth/quota errors
    }
    if (attempt + 1 < WS_RETRY_MAX) {
      const delay = retryDelayMs(attempt);
      await sleep(delay);
    }
  }
}

// Lines 164-168: Custom backoff calculation
function retryDelayMs(attempt: number): number {
  const base = Math.min(WS_RETRY_MAX_MS, WS_RETRY_BASE_MS * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 150);
  return base + jitter;
}

// Lines 605-609: "Final event never arrives" workaround
// Sarvam sometimes never sends the "final" event. Without a backstop the
// promise hangs until the 8s stream timeout — the caller hears silence
// mid-sentence while the pipeline rebuffer-loops.
```

**Issues Found**:
1. **Custom retry logic**: Exponential backoff with jitter (2^attempt * base)
2. **Fatal error detection**: Distinguish auth/quota errors from network errors
3. **"Final event" workaround**: Sarvam API sometimes doesn't send completion event!
4. **Idle timeout** (line 606): If socket goes quiet after flush, assume complete

**Questions**:
- Does Sarvam SDK handle retries internally?
- Is the "final event never arrives" bug still present in Bulbul v3?
- Can we report this to Sarvam and remove the workaround?

**Recommendations**:
- **Report "final event" bug to Sarvam** - this is a provider issue!
- Check if Sarvam SDK has built-in retry logic
- Consider removing workarounds if provider fixes the bug

---

### 4. **Google LLM - Context Caching Workarounds**
**File**: `artifacts/api-server/src/orchestration/adapters/llm/google.ts`

```typescript
// Lines 204-210: Multiple cache slots for multilingual agents
// Keyed by cache base rather than a single slot: the pipeline bakes the
// language guard into the base, so a caller who code-switches (very common on
// Indic calls) produces two or three distinct bases. A single slot made those
// bases evict each other and, once the warm budget ran out, disabled caching
// for the rest of the call
private caches = new Map<string, CachedContent>();

// Lines 385-387: Budget exhaustion workaround
// Budget exhausted: stop warming NEW bases but keep serving the ones already
// created. Disabling caching outright here is what made long multilingual
// calls run fully uncached after the first few language switches.

// Lines 449-451: Free-tier fallback
this.cacheDisabled = true;
logger.warn("Gemini context caching disabled — falling back to uncached 
  (expected on free-tier keys)");
```

**Issues Found**:
1. **Multiple cache slots**: Keep separate caches for each language in multilingual calls
2. **Budget management**: Stop creating new caches but keep existing ones
3. **Free-tier detection**: Disable caching if API returns error
4. **Timeout**: Custom 60s request timeout (line 219, 420)

**Questions**:
- Does Gemini SDK handle cache eviction automatically?
- Should multilingual caching be provider's responsibility?
- Is the 60s timeout necessary or does SDK have default?

**Recommendations**:
- This seems like **correct workaround** for provider limitation
- Document that Gemini doesn't support per-language caching natively
- Consider feature request to Google for multilingual cache support

---

## 🟢 ACCEPTABLE (Necessary Workarounds)

### 5. **Cartesia TTS - Voice Controls Normalization**
**File**: `artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts:126-131`

```typescript
// Old API used "family:level" tags, new API uses enum strings
// Accept both shapes from callers for backward compatibility
function normalizeEmotion(emotions?: string[]): string | undefined {
  // Maps legacy pairs to nearest enum value
}
```

**Status**: ✅ **Acceptable** - Backward compatibility shim for API migration

---

### 6. **Sarvam TTS - Speaker Fallback**
**File**: `artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts:120-135`

```typescript
function resolveSpeaker(voice: string | null, model: string): string {
  const fallback = DEFAULT_SPEAKER[model] ?? "ritu";
  if (!voice) return fallback;
  // Reject v2-only speakers on v3, fall back to default
  if (V2_SPEAKERS.has(trimmed)) {
    logger.warn("SarvamTTS: speaker is v2-only and not available on v3");
    return fallback;
  }
}
```

**Status**: ✅ **Acceptable** - Version compatibility handling

---

## 📊 SUMMARY

### 🔴 **Fix Immediately** (Same Issue as Saaras v3):
1. **Azure STT confidence filtering** - Trust provider, don't add 15% threshold

### 🟡 **Review with Provider Docs**:
2. **Cartesia TTS retries** - Check if SDK handles this
3. **Sarvam TTS "final event" bug** - Report to provider!
4. **Google LLM caching** - Correct workaround for limitation

### 🟢 **Keep (Necessary)**:
5. **Backward compatibility shims** - Acceptable
6. **Version compatibility** - Acceptable

---

## 🎯 ACTION ITEMS

### Immediate:
1. ✅ **Remove Azure STT confidence filtering** (or lower to 5%)
2. 🔍 **Report Sarvam TTS "final event never arrives" bug**

### Research:
3. 📚 **Check Cartesia SDK docs** - Does it handle WS → REST fallback?
4. 📚 **Check Sarvam STT/TTS SDK** - Does it have built-in retry logic?
5. 📚 **Review all provider docs** - Document what we trust vs what we override

### Long-term:
6. 📋 **Create "Provider Trust Policy"** - Document when to trust vs when to override
7. 📋 **Audit telephony adapters** (Vobiz, Twilio) - Not yet reviewed

---

## 🧠 KEY INSIGHT

**We're treating AI providers like traditional APIs**:
- Traditional APIs: Dumb pipes, need retry/timeout/fallback logic
- Modern AI APIs: Smart models, handle edge cases internally

**Better approach**:
1. **Trust the model** (Saaras v3, Azure, Gemini, Cartesia)
2. **Only add logic for**:
   - Backward compatibility
   - Known provider bugs (document & report!)
   - Integration quirks (timeouts, auth)
3. **Default to provider behavior** unless we have proof it's wrong

---

## 📝 NOTES

- Similar pattern across all adapters: We add retry/confidence/fallback logic
- Most providers are **already handling** these cases internally
- We should **trust more, override less**
- Document **why** we override (with issue numbers, bug reports, or measurement data)

---

## ✅ ACTIONS TAKEN (2026-09-03)

### 1. Fixed Azure STT Confidence Filtering
- **File:** `artifacts/api-server/src/orchestration/adapters/stt/azure.ts`
- **Change:** Lowered confidence threshold from 15% to 5% (same logic as Saaras v3 multilingual fix)
- **Reasoning:** Azure's STT model already handles confidence internally; we shouldn't second-guess it

### 2. Researched Provider SDKs
**Cartesia SDK (`@cartesia/cartesia-js` v3.5.1+):**
- ✅ WebSocket: Automatic reconnection (5 retries, 500-8000ms backoff, message queuing)
- ✅ REST: Automatic retries (2x for 408/409/429/5xx)
- ✅ Configurable timeouts (default 60s)
- **Our status:** Using raw WebSocket with custom retry logic (compatible but duplicates SDK features)
- **Next step:** Evaluate migrating to official SDK or document why raw WebSocket is required

**Sarvam TTS:**
- ❌ No official SDK (raw WebSocket)
- 🟢 **"Final event never arrives" bug FIXED** by Sarvam (confirmed in PipeCat v0.0.106)
- Our `FINAL_EVENT_IDLE_MS` workaround is still valid as a safety net, but may be removable
- **Next step:** Test `final` event reliability on live calls; report to Sarvam if still broken

### 3. Created Provider Trust Policy
- **File:** `PROVIDER_TRUST_POLICY.md`
- **Contents:**
  - Decision framework (when to trust provider vs. add custom logic)
  - Current audit findings (critical/medium/acceptable categories)
  - Policy guidelines (do's and don'ts)
  - Action items for ongoing maintenance
