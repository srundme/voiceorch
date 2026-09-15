# Provider Trust Policy

**Version:** 1.0  
**Last Updated:** 2026-09-03  
**Status:** Active

---

## Core Principle

**Trust the provider's native capabilities.** Only add custom logic when the provider explicitly lacks a feature or has a documented bug.

### Why This Matters

1. **Redundant logic** → Extra latency, complexity, and bugs (e.g., confidence filtering breaking multilingual speech)
2. **Provider improvements** → When vendors fix their APIs, our custom workarounds become obsolete or counterproductive
3. **Maintenance burden** → Every custom layer requires ongoing validation against provider updates

---

## Decision Framework

When implementing or reviewing an adapter, ask:

```
┌─────────────────────────────────────────────────┐
│ Does the provider's API/SDK handle this?        │
└────────────────┬────────────────────────────────┘
                 │
         ┌───────┴────────┐
         │                │
        YES              NO
         │                │
         ▼                ▼
    USE PROVIDER    IS THERE A BUG?
    DIRECTLY              │
                   ┌──────┴───────┐
                   │              │
                  YES            NO
                   │              │
                   ▼              ▼
            WORKAROUND       ADD FEATURE
            + REPORT BUG     (documented)
```

---

## Current Audit Findings

### 🔴 **CRITICAL: Must Fix**

#### 1. Azure STT Confidence Filtering
- **File:** `adapters/stt/azure.ts:380-395`
- **Issue:** Hardcoded 15% confidence floor "for Indic languages" — mirrors the Saaras v3 mistake
- **Reality:** Azure's STT model already handles confidence internally; it only returns transcripts it's confident about
- **Fix:** Lower to 5% (only filter extreme noise), same as Saaras v3 multilingual fix
- **Status:** ✅ **FIXED** (2026-09-03)

---

### 🟡 **MEDIUM: Review & Simplify**

#### 2. Cartesia TTS WebSocket → REST Fallback
- **File:** `adapters/tts/cartesia.ts:280-320`
- **Custom Logic:**
  - WebSocket connect timeout (6s)
  - Retry with exponential backoff (2 retries, 300ms base)
  - REST fallback on WS failure
  - Emotion control retries (5x, EMOTION_RETRY_BASE_MS)
- **Provider SDK:** ✅ **Exists** — `@cartesia/cartesia-js` v3.5.1+
  - WebSocket: Automatic reconnection (5 retries, 500-8000ms backoff, message queuing)
  - REST: Automatic retries (2x for 408/409/429/5xx, exponential backoff)
  - Timeout: Configurable (default 60s)
- **Assessment:** Our logic is **compatible** with provider capabilities, but we're duplicating what the SDK already does
- **Next Step:** Evaluate migrating to official SDK or document why raw WebSocket is required (e.g., custom streaming protocol)

#### 3. Sarvam TTS "Final Event Never Arrives" Workaround
- **File:** `adapters/tts/sarvam.ts:30-34, 440-460`
- **Custom Logic:** `FINAL_EVENT_IDLE_MS` (2500ms) — if no message after flush, assume `final` was lost and resolve
- **Provider SDK:** ❌ **No official SDK** — raw WebSocket
- **Bug Status:** 🟢 **FIXED** by Sarvam (confirmed in PipeCat v0.0.106, 2025-11-04)
  - `send_completion_event=true` now reliably sends `{"type": "event", "data": {"event_type": "final"}}`
  - PipeCat removed their idle timer workaround after this fix
- **Assessment:** Our workaround is **still valid** as a safety net, but may be removable after testing
- **Next Steps:**
  1. Test with `send_completion_event=true` on live calls
  2. If `final` arrives reliably, remove `FINAL_EVENT_IDLE_MS` logic
  3. Report to Sarvam if `final` is still missing (include call logs)

#### 4. Google LLM Context Caching Workaround
- **File:** `adapters/llm/google.ts:420-450`
- **Custom Logic:**
  - On multilingual agents with Sarvam TTS, avoid context caching (workaround for latency bug)
  - Custom request timeout (60s, raised from default)
- **Provider SDK:** ✅ **Exists** — `@google/generative-ai`
- **Assessment:** Workaround is **justified** (multilingual + Sarvam TTS = latency spike), but should be revisited as Gemini context caching improves
- **Next Step:** Periodically test multilingual + caching to see if Google has fixed the latency issue

---

### 🟢 **ACCEPTABLE: Keep**

#### 5. Sarvam Saaras v3 Language Drift Detection
- **File:** `adapters/stt/sarvam-realtime.ts:160-180`
- **Custom Logic:** `LID_DRIFT_CONFIDENCE_BAR` (0.6) — emit language change only if confidence ≥ 60%
- **Assessment:** ✅ **Good** — prevents transient noise from triggering language switches
- **Note:** This is a *feature on top of* Saaras's native detection, not a replacement for it

---

## Policy Guidelines

### ✅ **DO**

1. **Use provider SDKs** when available (retries, reconnection, timeouts come free)
2. **Document workarounds** with:
   - Why the workaround exists (provider bug? missing feature?)
   - Link to provider docs/issue tracker
   - Date added
   - Criteria for removal ("remove when provider adds X")
3. **Test provider improvements** — review workarounds quarterly against provider changelogs
4. **Report bugs upstream** — help providers fix issues at the source

### ❌ **DON'T**

1. **Don't add confidence filters** unless the provider explicitly recommends it (Azure, Saaras v3)
2. **Don't implement retries** if the SDK already does it
3. **Don't "guess" provider behavior** — if it's not in the docs, ask support or test empirically
4. **Don't keep workarounds forever** — remove them when the provider fixes the underlying issue

---

## Action Items (from 2026-09-03 Audit)

- [x] Fix Azure STT confidence filtering (same as Saaras v3 fix)
- [ ] Review Cartesia SDK docs → decide if we should migrate from raw WebSocket
- [ ] Review Sarvam STT/TTS docs → check for SDK updates
- [ ] Test Sarvam TTS `final` event reliability → remove `FINAL_EVENT_IDLE_MS` if fixed
- [ ] Audit telephony adapters (Vobiz, Twilio) — apply same "trust the provider" lens
- [ ] Create quarterly review cadence — revisit all workarounds against provider changelogs

---

## References

- **Cartesia SDK:** [github.com/cartesia-ai/cartesia-js](https://github.com/cartesia-ai/cartesia-js)
- **Sarvam TTS Final Event Bug Fix:** [PipeCat PR #4639](https://github.com/pipecat-ai/pipecat/pull/4639) (fixed in v0.0.106)
- **Saaras v3 Multilingual:** [docs.sarvam.ai](https://docs.sarvam.ai/api/integration/pipecat-production-guide)
- **Azure Speech Confidence:** [learn.microsoft.com/azure/cognitive-services/speech-service](https://learn.microsoft.com/)

---

## Version History

| Version | Date       | Changes                                                                 |
|---------|------------|-------------------------------------------------------------------------|
| 1.0     | 2026-09-03 | Initial policy; fixed Azure STT confidence filtering; documented audit |
