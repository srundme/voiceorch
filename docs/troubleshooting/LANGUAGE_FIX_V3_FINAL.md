# Language Detection Fix (FINAL - TRUSTING SAARAS V3)

**Date**: 2026-09-03  
**Issue**: We were building redundant logic on top of Saaras v3's native detection

---

## The REAL Issue (User Found It!)

### What We Were Doing (WRONG):
```typescript
// 1. Confidence threshold filtering
if (lidConfidence < 0.35 || lidConfidence < 0.7) {
  sttLang = null; // Reject Saaras's detection
}

// 2. Manual script detection
let detected = sttLang ?? detectScriptLanguage(transcript, devLang);
// ↑ Manually parsing Tamil/Devanagari/Telugu Unicode blocks

// 3. Devanagari disambiguation
if (devLang !== "hi-IN" && detected === "hi-IN" && hasDevanagari(transcript)) {
  detected = devLang; // Override Saaras
}
```

### What Saaras v3 ALREADY Does (from Sarvam documentation):

> **"Saaras v3 automatically detects the spoken language without requiring you to specify it upfront. When a speaker switches between Hindi and English mid-sentence, or drops Tamil words into an otherwise English conversation, the model follows along without losing accuracy at language boundaries. This is not a pipeline that detects language segments and routes them to separate engines. It is a single unified model that understands multilingual Indian speech as a continuous stream."**

---

## The Simplified Fix

### NEW APPROACH (Trust Saaras):
```typescript
if (this.agent.languageAutoDetect) {
  // Multilingual: Trust Saaras v3's native detection COMPLETELY
  // No confidence filtering
  // No script detection overlay
  // Saaras handles code-mixing, transliteration, borrowed words natively
  let detected = sttLang; // Use Saaras's language directly
} else {
  // Single-language: Only reject garbage (confidence < 10%)
  if (lidConfidence < 0.1) {
    sttLang = null; // Reject only noise/silence
  }
}
```

---

## What Changed

### Before (OVER-ENGINEERED):
- ❌ Confidence threshold: 35% (multilingual) / 70% (single-language)
- ❌ Script detection: Manual Unicode block parsing
- ❌ Devanagari disambiguation: Override Saaras's decision
- ❌ False positives on Hinglish (rejected 37% confidence)
- ❌ Fighting against Saaras's unified model

### After (TRUST SAARAS):
- ✅ **Multilingual**: No confidence filter, no script detection
- ✅ **Single-language**: 10% bar (only rejects actual noise)
- ✅ Saaras handles code-mixing natively (Hinglish, Tanglish)
- ✅ Saaras follows language switches in real-time
- ✅ No manual overrides of Saaras's decisions

---

## Why This Fixes Your Issues

### Problem in Calls 19992 & 19994:
```json
// Agent was configured WRONG:
{
  "agentId": 947,
  "asrLanguage": "hi-IN",        // ← Should be ta-IN (Tamil)
  "languageAutoDetect": false    // ← Should be true (multilingual)
}

// User spoke Hinglish:
"Ji, mere paas bus cycle hai"

// Old logic:
Saaras detected: en-IN (37% confidence)
Our filter: 37% < 70% → REJECTED
Result: Agent stayed in Hindi (correct by accident)

// But then agent started in wrong language!
```

### With Correct Agent Config:
```json
{
  "agentId": 947,
  "asrLanguage": "ta-IN",        // ← Tamil primary
  "languageAutoDetect": true,    // ← Multilingual ON
  "multilingualLanguages": ["ta-IN", "hi-IN", "en-IN"]
}

// Saaras behavior:
language_code: "auto"  → Saaras auto-detects every turn
Agent starts: Tamil
User switches to Hindi: Saaras detects hi-IN → Agent switches
User switches to English: Saaras detects en-IN → Agent switches
Code-mixing: Saaras handles natively, no language "switch"
```

---

## Key Insight from Documentation

**Saaras v3 is NOT a language router:**
- It's a **unified model** that understands multilingual speech
- It handles **code-mixing** (Hinglish, Tanglish) without "switching"
- It follows **mid-sentence language changes** seamlessly
- It has **native awareness** of borrowed words, transliteration, mixed script

**We were treating it like a simple ASR + language classifier**, when it's actually a **multilingual understanding model**.

---

## What You Need to Do

**Update Agent 947 Configuration**:

```sql
UPDATE agents 
SET 
  "asrLanguage" = 'ta-IN',
  "languageMode" = 'multi',
  "languageAutoDetect" = true,
  "multilingualLanguages" = '["ta-IN", "hi-IN", "en-IN"]'::jsonb
WHERE id = 947;
```

**OR via Vibe**:
1. Edit agent 947
2. Primary language: **Tamil (India)**
3. **Toggle "Switch language" ON**
4. Add languages: **Tamil, Hindi, English**
5. Save

---

## How It Works Now

### Multilingual Agent (languageAutoDetect=true):
```
1. Agent starts in Tamil (primary language)
2. User: "வணக்கம் மேடம்" (Tamil)
   → Saaras: ta-IN → Agent responds in Tamil ✓

3. User: "Mere paas ek sawal hai" (Hindi)
   → Saaras: hi-IN → Agent switches to Hindi ✓

4. User: "Can you explain in English?" (English)
   → Saaras: en-IN → Agent switches to English ✓

5. User: "Okay yes thank you" (English fillers)
   → Saaras: continues previous language ✓
   → No false "switch" on borrowed words

6. User: "Mujhe Tamil me baat karni hai" (Hindi with Tamil request)
   → Explicit request detected → Agent switches to Tamil ✓
```

### Single-Language Agent (languageAutoDetect=false):
```
1. Agent stays in configured language (e.g., Hindi)
2. User: "Ji madam, okay" (Hinglish)
   → Saaras: hi-IN or en-IN (doesn't matter)
   → Agent stays in Hindi ✓
   → Only 10% bar: rejects noise, not speech

3. User: "Can you speak in English?"
   → Explicit request detected → Agent switches ✓
```

---

## Testing

**Before deploying, test:**

1. **Multilingual switching**:
   ```
   Start in Tamil → Speak Hindi → Should switch naturally
   ```

2. **Code-mixing**:
   ```
   "Mere paas okay hai madam" → Should NOT thrash between languages
   ```

3. **Borrowed words**:
   ```
   "Yes okay thank you" → Should NOT trigger false switches
   ```

---

## Summary

✅ **Root cause**: We didn't trust Saaras v3's native multilingual detection  
✅ **Fix**: Removed redundant confidence threshold and script detection  
✅ **Result**: Saaras handles language naturally (unified model, code-mixing aware)  
⚠️ **Action required**: Update agent 947 config (Hindi → Tamil + enable multilingual)

**The real bug wasn't in the code — it was in the agent configuration AND our lack of trust in Saaras v3!**
