# Call 20088 — Issue Analysis

**Call ID**: 20088  
**Agent**: Shanaya (ID: 930)  
**Duration**: 99 seconds (1m 39s)  
**Turns**: Only 5 turns (very low)  
**End Reason**: **Silence timeout** (no caller speech detected)  
**Warning Count**: 7  
**Barge-In**: ✅ 1 barge-in fired (VAD fix IS working!)

---

## 🔴 **Critical Issues**

### 1. **Language Detection Failing** ❌

**Problem**: Sarvam is detecting Hindi speech as `en-IN` (English) instead of `hi-IN` (Hindi)

**Evidence**:
```json
{
  "transcript": "Hmm, हां जी",  // Hindi text
  "detectedLang": "en-IN",      // ❌ WRONG! Should be hi-IN
  "languageConfidence": 0.8
}

{
  "transcript": "Okay ਜੀ",      // Punjabi script mixed
  "detectedLang": "en-IN",      // ❌ WRONG!
  "languageConfidence": 0.76
}

{
  "transcript": "Hmm, सही है। Book करती",  // Hindi
  "detectedLang": "en-IN",                  // ❌ WRONG!
  "languageConfidence": 0.95               // High confidence but wrong language!
}
```

**Impact**:
- LID drift protection kicked in: `"languagePinnedTo": "hi-IN"` with low confidence (0.41)
- Agent keeps asking caller to repeat because transcripts don't make sense
- Call flow breaks down

---

### 2. **TTS Audio Breaking (Underruns)** ❌

**Problem**: Multiple TTS playback underruns causing audio glitches

**Evidence**:
```json
{
  "event": "Playback underruns (audible glitch)",
  "underrunCount": 2,
  "underrunWaitMs": 1032,  // 1 second delay!
  "concurrentDrains": 2,
  "provider": "cartesia"
}
```

**Occurrences**: 15 underrun/glitch/error events total

**Impact**:
- Caller hears choppy, breaking audio
- Voice quality degraded
- Professional experience compromised

---

### 3. **Incomplete/Poor Quality Transcripts** ❌

**Problem**: STT producing incomplete or very short transcripts

**Evidence**:
```
- "Hmm, हां जी"          // Too short
- "Sahiya"                // Just name
- "Okay ਜੀ"               // Minimal
- "Tomorrow, tom"         // ❌ INCOMPLETE! Should be "Tomorrow 12:30 PM"
- "Hmm."                  // Just filler
- "Yes"                   // Too short
```

**Impact**:
- Multiple "no usable transcript — prompting caller again" events
- Agent keeps asking "क्या आप दोबारा कह सकते हैं?" (Can you repeat?)
- Call gets stuck in a loop

---

### 4. **Call Ended Prematurely (Silence Timeout)** ❌

**Problem**: Call ended after only 99 seconds and 5 turns

**Evidence**:
```json
{
  "reason": "silence_timeout",
  "reasonLabel": "Silence timeout — no caller speech detected",
  "lastUserTranscript": "Yes",
  "lastAgentResponse": "माफ़ कीजिए, मैं समझ नहीं पाया — क्या आप दोबारा कह सकते हैं?"
  // Translation: "Sorry, I didn't understand — can you repeat?"
}
```

**Root Cause**: Transcripts are so poor that the agent can't understand, keeps asking to repeat, caller gets frustrated and stops responding.

---

## ✅ **What's Working**

### 1. **Barge-In Detection** ✅

**Success!** The VAD fix IS working:

```json
{
  "event": "Barge-in Detected",
  "trigger": "vad_partial",          // ✅ Using Sarvam's VAD!
  "sequenceInvalidated": 5,
  "heardPreview": "ठीक है",
  "transcriptPreview": "Tomorrow, tom"
}
```

**Metrics**:
- `bargeInFiredTotal`: 1 (was 0 before!)
- Trigger: `vad_partial` (correct — using Sarvam's VAD)

---

## 🎯 **Root Causes**

### Primary Issue: **Sarvam STT Language Detection Bug**

The core problem is that **Sarvam's STT is misdetecting the language**:

1. User speaks in **Hindi** (हां जी, सही है, etc.)
2. Sarvam detects it as **en-IN** (English) with HIGH confidence (0.8-0.95)
3. This is causing:
   - Incorrect language routing
   - LID drift protection triggering incorrectly
   - Agent unable to process transcripts properly

### Secondary Issue: **Cartesia TTS Underruns**

- TTS audio is not streaming fast enough
- Causing 1+ second delays and choppy audio
- Degrading call quality

---

## 🔧 **Recommended Fixes**

### 1. **Language Detection (HIGH PRIORITY)** 🔥

**Problem**: Why is Sarvam detecting Hindi as English?

**Investigation needed**:
```typescript
// Check agent 930 configuration
- Is languageAutoDetect enabled?
- Is language_code set to "auto" or "hi-IN"?
- Are multilingualLanguages configured correctly?

// Check STT adapter configuration
- Is Sarvam using language_code=auto?
- Should we pin to hi-IN for this agent?
- Is the "trust Saaras v3" logic working correctly?
```

**Potential Solution**:
```typescript
// If agent memory says language_pref="hindi", PIN to hi-IN instead of auto
if (callerLanguagePref === "hindi" && !agent.languageAutoDetect) {
  sttLanguageCode = "hi-IN";  // Pin to Hindi, don't use auto
}
```

---

### 2. **Fix TTS Underruns** 🔥

**Current Issue**:
- `underrunCount: 2`, `underrunWaitMs: 1032`
- `concurrentDrains: 2` (multiple TTS streams competing)

**Potential Solutions**:
1. Increase TTS prebuffer: `TTS_PREBUFFER_WARM_MS` (currently 480ms)
2. Increase concurrency boost: `TTS_CONCURRENCY_BOOST_MS_2` (currently 120ms)
3. Check Cartesia API latency to India
4. Consider switching to Sarvam TTS for Hindi (native provider)

---

### 3. **Improve Transcript Quality**

**Issues**:
- Incomplete transcripts: "Tomorrow, tom" instead of "Tomorrow 12:30 PM"
- Very short transcripts: "Yes", "Hmm."
- Mixed scripts: "Okay ਜੀ" (Punjabi script)

**Potential Solutions**:
1. Check VAD sensitivity settings (might be cutting off speech too early)
2. Increase `min_speech_duration_ms` for Sarvam STT
3. Review `silence_duration_ms` tuning

---

## 📋 **Action Items**

### Immediate (P0)
1. ✅ **Investigate agent 930 STT configuration** — Why is Hindi detected as English?
2. ✅ **Check Sarvam STT language mode** — Should it be pinned to `hi-IN` instead of `auto`?
3. ✅ **Test Cartesia TTS latency** — Are underruns due to network or configuration?

### Short-term (P1)
4. ⏳ **Tune TTS prebuffer settings** — Eliminate underruns
5. ⏳ **Review VAD sensitivity** — Fix incomplete transcripts
6. ⏳ **Test with pinned language** — Compare `hi-IN` vs `auto` detection

### Medium-term (P2)
7. ⏳ **Consider Sarvam TTS for Hindi** — Native provider may have better latency
8. ⏳ **Add language detection confidence logging** — Track misdetection patterns
9. ⏳ **Implement transcript quality checks** — Reject extremely short transcripts

---

## 📊 **Comparison: Before vs After VAD Fix**

| Metric | Call 20074 (Before) | Call 20088 (After) |
|--------|--------------------|--------------------|
| **Barge-in fired** | 0 ❌ | 1 ✅ |
| **Barge-in method** | Energy threshold | VAD + partial ✅ |
| **Language detection** | Working | Broken ❌ |
| **TTS quality** | OK | Underruns ❌ |
| **Call success** | Failed (no barge-in) | Failed (lang + TTS) |

---

## 🎯 **Next Steps**

**User should provide**:
1. Agent 930 configuration (asrLanguage, languageAutoDetect, multilingualLanguages)
2. Confirmation of caller's actual language preference
3. Whether Hindi detection issues are consistent across other calls

**We should investigate**:
1. Why Sarvam is misdetecting Hindi as English
2. Cartesia TTS latency/underruns to India
3. Transcript quality issues

---

**Status**: 🔴 **Multiple Critical Issues** — Barge-in fixed, but language detection and TTS quality broken
