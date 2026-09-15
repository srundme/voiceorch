# Language Detection & Configuration Fix

**Date**: 2026-09-03  
**Calls Affected**: 19992, 19994, 19920-19926  
**Issue**: Agent speaking English suddenly, incorrect transcripts, wrong primary language

---

## Root Cause

### 1. Language Confidence Threshold Too Low (35%)

**Problem**: STT language detection threshold was **35%**, causing false positives:
- User speaks Hinglish/transliterated Hindi: `"Ji, mere paas bus cycle hai"`
- STT detects: `en-IN` with **37% confidence**
- Agent switches to **full English mode** permanently ❌

**Evidence from Logs**:
```json
// Call 19992, Turn 4
{
  "transcript": "Ji, mere paas bus cycle hai.",
  "detectedLang": "en-IN",
  "languageConfidence": 0.37  // 37% confidence triggered switch
}
// Next turn: Agent responds entirely in English
```

**Fix**: Raised threshold to **70%** in `pipeline.ts` (line 3959):
```typescript
// Old: if (sttLang && lidConfidence != null && lidConfidence < 0.35)
// New: if (sttLang && lidConfidence != null && lidConfidence < 0.7)
```

**Rationale**:
- 70% threshold requires **strong confidence** before switching language
- Prevents false positives on borrowed English words ("okay", "yes", "no")
- Aligns with `LID_DRIFT_CONFIDENCE_BAR = 0.6` used elsewhere
- User must speak **clear, full English sentences** to trigger switch

---

### 2. Agent Primary Language Misconfigured

**Problem**: Agent 947 (`rto1`) is configured with **Hindi (`hi-IN`)** as primary language, but should be **Tamil (`ta-IN`)**

**Evidence from Logs**:
```json
// Both calls 19992 and 19994
{
  "component": "STT",
  "metadata": {
    "event": "Provider Initialized",
    "provider": "sarvam",
    "language": "hi-IN"  // Should be "ta-IN"
  }
}
```

**Fix Required**: Update agent configuration via database or admin panel:

```sql
-- Check current configuration
SELECT id, name, "asrLanguage" FROM agents WHERE id = 947;

-- Update to Tamil (if needed)
UPDATE agents 
SET "asrLanguage" = 'ta-IN' 
WHERE id = 947;
```

**OR** via admin panel:
1. Navigate to Agent Settings for agent 947 (`rto1`)
2. Update **ASR Language** field to `ta-IN` (Tamil)
3. Save changes

---

## Impact of Fixes

### Before Fix (Threshold 35%)
- ❌ User says Hinglish → Agent switches to English (37% confidence)
- ❌ User says "Yes Madam" → Agent switches to English (47% confidence)
- ❌ Agent responds entirely in English for rest of call
- ❌ User confused, conversation breaks down

### After Fix (Threshold 70%)
- ✅ User says Hinglish → Agent stays in Tamil/Hindi (37% ignored)
- ✅ Borrowed English words don't trigger switch
- ✅ Agent only switches on **clear, confident English sentences**
- ✅ Language switching is explicit and intentional

---

## Testing Plan

1. **Test Hinglish Input** (should NOT switch):
   ```
   User: "Ji Madam, mere paas gaadi nahi hai"
   Expected: Agent responds in Tamil (if configured) or Hindi
   ```

2. **Test Full English Sentence** (should switch):
   ```
   User: "Can you please tell me what is the challan amount?"
   Expected: Agent switches to English (high confidence)
   ```

3. **Test Borrowed Words** (should NOT switch):
   ```
   User: "Yes Madam, okay, thank you"
   Expected: Agent stays in original language
   ```

---

## Deployment

**Commit**: `9b7d9a09d`  
**Branch**: `main`

Deploy after this commit:
```bash
# Push to main
git push origin main

# Verify deployment
# Check logs for "STT language ignored — language_confidence too low"
# Confidence should now require ≥70% instead of ≥35%
```

**Post-Deploy Verification**:
1. Make test call with agent 947
2. Speak Hinglish phrases
3. Verify agent does NOT switch to English
4. Check logs for threshold rejection: `"STT language ignored — language_confidence too low"`

---

## Related Issues

- ✅ **Barge-in fixed** (commit `7c4b6b1ad`)
- ✅ **Background speaker filter** (commit `f70ac9fc4`)
- ✅ **Noise cancellation** (commit `e3e28437e`)
- ✅ **Language detection threshold** (commit `9b7d9a09d`) ← **THIS FIX**
- ⚠️ **Agent primary language** (database update required)

---

## Notes

- This fix addresses **false positive** language switching
- **True positive** switching still works (user speaks clear English)
- Agent configuration (Tamil primary language) must be updated separately
- No breaking changes to STT or orchestration logic
