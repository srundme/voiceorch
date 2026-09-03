# Devanagari Filler Detection Fix

**Date**: 2026-09-03  
**Commit**: `b07a0f66b`  
**Status**: ✅ Ready for deployment

---

## Problem

Call 20088 logs showed standalone Devanagari Hindi fillers were **NOT being suppressed** by the filler suppression logic:

- **"ओके"** (Devanagari "ok")
- **"अच्छा"** (Devanagari "accha")  
- **"अच्छा जी"** (Devanagari "accha ji")

These were being enqueued as **separate TTS jobs**, causing:
1. **Artificial concurrency** → more underruns
2. **Out-of-order playback** → overlapping audio
3. **Choppy experience** → bare fillers playing before substantive sentences

## Root Cause

The filler detection patterns in `transcriptQuality.ts` included **romanized** Hindi:
- ✅ "accha" (romanized)
- ✅ "haan" (romanized)
- ✅ "ok" / "okay" (English)

But were **missing Devanagari script** versions:
- ❌ "अच्छा" (Devanagari)
- ❌ "ओके" (Devanagari)

This was identified in the self-review documented in `CODE_REVIEW_SANITY_CHECK.md`.

## Fix Applied

Updated three regex patterns in `artifacts/api-server/src/orchestration/transcriptQuality.ts`:

### 1. `REDUPLICATED_ACK_RE` (lines 57-59)
**Before**:
```javascript
/^(ok(ay)?|yes|yeah|ஆமா|சரி|ठीक)([\s,.!]+(ok(ay)?|yes|yeah|ஆமா|சரி|ठीक)){0,2}[\s,.!]*$/i
```

**After**:
```javascript
/^(ok(ay)?|yes|yeah|ஆமா|சரி|ठीक|ओके|अच्छा)([\s,.!]+(ok(ay)?|yes|yeah|ஆமா|சரி|ठीक|ओके|अच्छा)){0,2}[\s,.!]*$/i
```

### 2. `INDIC_SINGLE_ACK_RE` (lines 60-62)
**Before**:
```javascript
/^(சரி|சரிங்க|ஆமா|ஆம்|இல்ல|இல்லை|हां|हाँ|ठीक|जी|haan|han|theek|accha|hmm|hm|mm)[\s,.!]*$/iu
```

**After**:
```javascript
/^(சரி|சரிங்க|ஆமா|ஆம்|இல்ல|இல்லை|हां|हाँ|ठीक|ओके|अच्छा|जी|haan|han|theek|accha|hmm|hm|mm)[\s,.!]*$/iu
```

### 3. `INDIC_ACK_VOCATIVE_RE` (lines 64-66)
**Before**:
```javascript
/^(ஆமா|ஆம்|சரி|haan|ok(?:ay)?)([\s,.!]+(சார்|sir|जी|ji|madam|மா.?ம்|ஆமா|ஆம்|சரி|हां|हाँ|haan|ok(?:ay)?)){0,4}[\s,.!]*$/iu
```

**After**:
```javascript
/^(ஆமா|ஆம்|சரி|ठीक|ओके|अच्छा|haan|ok(?:ay)?)([\s,.!]+(சார்|sir|जी|ji|madam|மா.?ம்|ஆமா|ஆம்|சரி|हां|हाँ|ठीक|ओके|अच्छा|haan|ok(?:ay)?)){0,4}[\s,.!]*$/iu
```

### 4. `isUltraShortNoiseFragment` inline pattern (line 172)
**Before**:
```javascript
/^(சரி|சரிங்க|ஆமா|ஆம்|இல்ல|இல்லை|हां|हाँ|ठीक|जी|नहीं|nahi|haan|ha[a]?n)[\s,.!]*$/iu
```

**After**:
```javascript
/^(சரி|சரிங்க|ஆமா|ஆம்|இல்ல|இல்லை|हां|हाँ|ठीक|ओके|अच्छा|जी|नहीं|nahi|haan|ha[a]?n)[\s,.!]*$/iu
```

## Impact

Now `isBackchannelOnlyUtterance()` correctly identifies **both romanized AND Devanagari** fillers:

| Filler | Before | After |
|---|---|---|
| "ok" / "okay" | ✅ Suppressed | ✅ Suppressed |
| "ओके" | ❌ **Enqueued as TTS** | ✅ Suppressed |
| "accha" | ✅ Suppressed | ✅ Suppressed |
| "अच्छा" | ❌ **Enqueued as TTS** | ✅ Suppressed |
| "अच्छा जी" | ❌ **Enqueued as TTS** | ✅ Suppressed |
| "ठीक" | ✅ Suppressed | ✅ Suppressed |

This ensures the filler suppression logic in `pipeline.ts` (lines 9020-9057) works correctly for **all Indian languages regardless of script**.

## Testing

### Test Cases
1. **Hindi agent** receiving "ओके" → Should suppress
2. **Hindi agent** receiving "अच्छा जी" → Should suppress
3. **Multilingual agent** receiving "ok okay अच्छा" → Should suppress
4. **Real content** like "कल दोपहर का समय अच्छा है" → Should NOT suppress (contains substantive sentence)

### Expected Behavior
- Standalone ultra-short fillers are now **merged with the next substantive sentence** in the LLM streaming split logic
- No separate TTS jobs for bare fillers
- Reduced TTS concurrency → fewer underruns
- No overlapping/out-of-order filler audio

## Deployment

**Files Changed**:
- `artifacts/api-server/src/orchestration/transcriptQuality.ts`

**Breaking Changes**: None

**Rollback Plan**: Revert commit `b07a0f66b`

**Monitoring**:
- Watch for `standalone_filler_suppressed` log events
- Verify no increase in false-positive suppression of real content
- Monitor TTS underrun rates (should decrease slightly)

## Reminder

**2nd Developer on this repo**:
- Name: **Varsha**
- GitHub: `varshaappbeatsol`
- Email: `varsha.mohan@appbeatsol.com`

---

**Ready to deploy** ✅
