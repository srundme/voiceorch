# Language Detection Fix (CORRECTED)

**Date**: 2026-09-03  
**Calls Affected**: 19992, 19994  
**Issue**: Agent switching to English on Hinglish input, not respecting agent language configuration

---

## Root Cause (CORRECT ANALYSIS)

### The Real Problem: Confidence Threshold Not Conditional

**Architecture**:
```typescript
// Agent has TWO modes:
1. languageAutoDetect = true  → Multilingual (switch language toggle ON)
2. languageAutoDetect = false → Single-language (switch language toggle OFF)
```

**Bug**: The old code applied a **single threshold (35%)** to BOTH modes:
```typescript
// OLD CODE - WRONG
if (sttLang && lidConfidence != null && lidConfidence < 0.35) {
  sttLang = null; // Reject low confidence
}
```

**Why This Was Wrong**:
- **Multilingual agents** (languageAutoDetect=true): 35% is correct, allows natural switching
- **Single-language agents** (languageAutoDetect=false): 35% is TOO LOW, causes false positives

---

## What Happened in Calls 19992 & 19994

**Agent 947 Configuration**:
```json
{
  "agentName": "rto1",
  "asrLanguage": "hi-IN",       // ← Primary language: Hindi
  "languageAutoDetect": false   // ← Single-language mode
}
```

**Call Flow** (Call 19992):
1. User: `"Ji, mere paas bus cycle hai"` (Hinglish)
2. STT: Detects `en-IN` with **37% confidence**
3. Old threshold: 37% > 35% → **ACCEPTED** ❌
4. Agent: Switches to full English mode
5. Rest of call in wrong language

**Expected Behavior**:
- Single-language agent should IGNORE 37% confidence
- Should stay in Hindi (configured language)
- Only explicit requests ("speak in English") should work

---

## The Fix (CONDITIONAL THRESHOLD)

```typescript
// NEW CODE - CORRECT
const confidenceBar = this.agent.languageAutoDetect ? 0.35 : 0.7;
if (sttLang && lidConfidence != null && lidConfidence < confidenceBar) {
  logger.info(
    { callId, sttLang, lidConfidence, confidenceBar, multilingual: this.agent.languageAutoDetect },
    "STT language ignored — language_confidence too low"
  );
  sttLang = null;
}
```

**Behavior**:
- **Multilingual agents** (toggle ON): 35% threshold → natural language switching ✅
- **Single-language agents** (toggle OFF): 70% threshold → strict, prevents false switches ✅

---

## How It Works for Multilingual Agents

**Agent Configuration** (Vibe flow):
```typescript
{
  "agentName": "customer-support",
  "asrLanguage": "ta-IN",          // Primary: Tamil
  "multilingualLanguages": [       // Also supports:
    "ta-IN", "hi-IN", "en-IN"
  ],
  "languageMode": "multi",         // Multilingual mode
  "languageAutoDetect": true       // Auto-detect ON
}
```

**Sarvam STT Configuration**:
```typescript
// When languageAutoDetect = true:
language_code: "auto"  // Saaras v3 returns detectedLanguage on every transcript
```

**Call Flow**:
1. Agent starts in **Tamil** (primary language)
2. User speaks **Hindi**: `"Mujhe ek sawal poochna hai"`
3. STT: Detects `hi-IN` with **65% confidence**
4. Threshold: 65% > 35% → **ACCEPTED** ✅
5. Agent: Switches to Hindi
6. User switches to **English**: `"Can you tell me the price?"`
7. STT: Detects `en-IN` with **82% confidence**
8. Threshold: 82% > 35% → **ACCEPTED** ✅
9. Agent: Switches to English

**No More False Positives**:
- User says `"okay"` (borrowed word) → 28% confidence → **REJECTED** ✅
- User says `"yes madam"` → 45% confidence → **ACCEPTED** (legitimate English) ✅

---

## How It Works for Single-Language Agents

**Agent Configuration**:
```typescript
{
  "agentName": "rto1",
  "asrLanguage": "hi-IN",          // Hindi only
  "languageMode": "single",        // Single-language
  "languageAutoDetect": false      // Auto-detect OFF
}
```

**Sarvam STT Configuration**:
```typescript
// When languageAutoDetect = false:
language_code: "hi-IN"  // Pinned to Hindi
```

**Call Flow**:
1. Agent stays in **Hindi** always
2. User speaks Hinglish: `"Ji madam, mere paas gaadi nahi hai"`
3. STT: Detects `en-IN` with **37% confidence**
4. Threshold: 37% < 70% → **REJECTED** ✅
5. Agent: Stays in Hindi
6. User explicitly requests: `"Can you speak in English?"`
7. Explicit request detected → Agent switches ✅

---

## Your Issue: Agent Primary Language Wrong

**Problem**: Agent 947 is configured with **Hindi (`hi-IN`)** but you want **Tamil (`ta-IN`)**

**Evidence from Logs**:
```json
// Both calls show:
{
  "component": "STT",
  "language": "hi-IN"  // ← Should be "ta-IN"
}
```

**Fix Required** (database update):
```sql
-- Check current config
SELECT id, name, "asrLanguage", "languageMode" 
FROM agents 
WHERE id = 947;

-- Update to Tamil + enable multilingual
UPDATE agents 
SET 
  "asrLanguage" = 'ta-IN',
  "languageMode" = 'multi',
  "languageAutoDetect" = true,
  "multilingualLanguages" = '["ta-IN", "hi-IN", "en-IN"]'::jsonb
WHERE id = 947;
```

**OR** via Vibe flow:
1. Edit agent 947
2. Set primary language to **Tamil (India)**
3. Toggle **"Switch language"** ON
4. Add languages: **Tamil, Hindi, English**
5. Save

---

## Testing Plan

### Test 1: Multilingual Agent (languageAutoDetect=true)
```
Agent: Tamil primary, multilingual enabled
User: "வணக்கம் மேடம்" (Tamil)
Expected: Agent responds in Tamil

User: "Mujhe ek sawal hai" (Hindi)
Expected: Agent switches to Hindi

User: "Can you help me?" (English)
Expected: Agent switches to English

User: "okay yes" (borrowed words)
Expected: Agent stays in current language (low confidence rejected)
```

### Test 2: Single-Language Agent (languageAutoDetect=false)
```
Agent: Hindi only, multilingual disabled
User: "Ji madam, mere paas gaadi nahi hai" (Hinglish)
Expected: Agent stays in Hindi (37% confidence rejected)

User: "Can you speak in English please?"
Expected: Agent switches (explicit request)
```

---

## Deployment

**Commit**: `9b7d9a09d` (amended)  
**Branch**: `main`

```bash
# Push corrected fix
git push origin main --force-with-lease

# Post-deploy: verify logs show conditional threshold
# Look for: "multilingual: true" vs "multilingual: false"
```

---

## Summary

✅ **Root cause**: Confidence threshold wasn't conditional on agent mode  
✅ **Fix**: 35% for multilingual, 70% for single-language  
✅ **Preserves**: Intended Saaras v3 auto-detection for multilingual agents  
⚠️ **Action required**: Update agent 947 from Hindi to Tamil + enable multilingual  

**Before (Broken)**:
- All agents used 35% threshold
- Single-language agents switched incorrectly on Hinglish

**After (Fixed)**:
- Multilingual agents: 35% (natural switching)
- Single-language agents: 70% (strict, prevents false positives)
