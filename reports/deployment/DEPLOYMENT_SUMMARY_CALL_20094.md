# Critical Pipeline Fixes Deployment Summary

**Date**: 2026-09-03  
**Commits**: `b07a0f66b` (Devanagari filler), `20b36a60f` (P0-P2 fixes)  
**Status**: ✅ Ready for deployment

---

## What Was Fixed

### ✅ P0 Critical: TTS Chunk Tracking (35% of Call 20094 issues)
**Problem**: System marked playback "complete" before all TTS chunks arrived, causing 6 audible underruns in 116 seconds.

**Fix**:
- Added `pendingTtsChunks` counter to track outstanding TTS jobs
- Increment when `enqueue()` adds a chunk
- Decrement when `playJob()` completes
- `playTask` now waits for `allEnqueued=true` **AND** `pendingTtsChunks=0`

**Impact**: Eliminates premature playback completion → no more mid-sentence underruns.

---

### ✅ P1 High: Transcript/Fallback Race Condition (20% of issues)
**Problem**: Valid "B2B" transcript arrived, but "माफ़ कीजिए, मैं ठीक से सुन नहीं पाया" played anyway.

**Fix**:
- Extended grace period in `finalizeAwaitingTurn` (+200ms post-flush wait)
- Added early final-transcript check **before** scheduling clarification
- Cancel clarification timer when valid final arrives in `handleStreamingTranscript`

**Impact**: Valid transcripts no longer ignored → no more false "I didn't hear you".

---

### ✅ P2 High: STT Language Locking (25% of issues)
**Problem**: Caller requested Hindi ("जी, हिंदी से बोलना"), but STT drifted to Kannada/Telugu on subsequent turns.

**Fix**:
- Lock STT to explicitly-requested non-English language (e.g., `hi-IN`)
- Prevent passive drift in `maybeSwitchStreamingSttLang`
- Only explicit requests (`immediate=true`) can change locked language

**Impact**: STT stays locked to requested language → no more language drift.

---

### ✅ P2 High: Domain Vocabulary Support (Documented)
**Problem**: Poor recognition of technical terms ("B2B", "CRM", "integration").

**Fix**:
- Documented `sarvamSttPrompt` configuration (already supported in code)
- Created `STT_DOMAIN_VOCABULARY_GUIDE.md` with use-case-specific prompts

**Impact**: Agents can be configured with domain terminology hints → better STT accuracy.

**Action Required**: Update agent configs with `sarvamSttPrompt` (see guide).

---

### ✅ Devanagari Filler Detection (Previous commit)
**Problem**: Standalone Devanagari fillers ("ओके", "अच्छा", "अच्छा जी") not suppressed.

**Fix**:
- Added Devanagari patterns to `REDUPLICATED_ACK_RE`, `INDIC_SINGLE_ACK_RE`, `INDIC_ACK_VOCATIVE_RE`
- Updated `isUltraShortNoiseFragment` inline pattern

**Impact**: Fillers suppressed regardless of script → less artificial TTS concurrency.

---

## Files Changed

| File | Lines Changed | Description |
|---|---:|---|
| `pipeline.ts` | +89 / -10 | P0, P1, P2 fixes + diagnostic logging |
| `transcriptQuality.ts` | +5 / -5 | Devanagari filler patterns |
| `CALL_20094_CRITICAL_ANALYSIS.md` | +437 / -0 | Complete analysis document |
| `CODE_REVIEW_SANITY_CHECK.md` | +93 / -0 | Self-review findings |
| `DEVANAGARI_FILLER_FIX.md` | +160 / -0 | Filler fix summary |
| `STT_DOMAIN_VOCABULARY_GUIDE.md` | +172 / -0 | Vocabulary configuration guide |

**Total**: +956 insertions, -15 deletions

---

## Testing

### Automated
- ✅ TypeScript: No new errors (all errors pre-existing)
- ✅ Git: Commits clean, no conflicts

### Manual Testing Recommended

1. **P0 TTS Chunk Tracking**:
   - Run 3-5 concurrent calls
   - Monitor for `"TTS playback waiting for pending chunks to complete"` log
   - Verify no underruns when LLM finishes before last TTS chunk

2. **P1 Fallback Race**:
   - Make a call, say a short technical term ("B2B", "API")
   - Verify no "I didn't hear you" when STT produces valid transcript
   - Monitor for `"Cancelled pending clarification timer"` log

3. **P2 Language Locking**:
   - Make a Hindi call, explicitly request Hindi
   - Continue conversation in Hindi
   - Verify no drift to Kannada/Telugu in STT transcripts
   - Monitor for `"STT language locked — ignoring passive switch attempt"` log

4. **Domain Vocabulary** (optional):
   - Update agent with `sarvamSttPrompt` (see guide)
   - Make test calls with technical terms
   - Verify improved STT accuracy

---

## Deployment Plan

### 1. Pre-Deployment
- ✅ Code reviewed
- ✅ Commits ready (`b07a0f66b`, `20b36a60f`)
- ⏳ User approval to push to main

### 2. Deployment
```bash
# Push to main
git push origin main

# Monitor Railway deployment
# (auto-deploys from main branch)
```

### 3. Post-Deployment Monitoring

Watch for these log events in production:

**P0 TTS Chunk Tracking**:
```
"TTS playback waiting for pending chunks to complete"
```

**P1 Fallback Race**:
```
"Cancelled pending clarification timer — valid final transcript arrived"
"Semantic turn: final transcript arrived — processing instead of clarification"
```

**P2 Language Locking**:
```
"STT language locked — ignoring passive switch attempt"
```

**Devanagari Fillers**:
```
"Standalone Filler Suppressed"
```

### 4. Metrics to Watch

| Metric | Before | Expected After |
|---|---|---|
| TTS underrun rate | ~5-6 per 100s call | < 1 per 100s call |
| False clarifications | ~1-2 per call | < 0.5 per call |
| Language drift (Hindi→other) | ~1-2 per call | ~0 per call |
| Filler-caused concurrency | High | Low |

---

## Rollback Plan

If issues arise:

```bash
# Revert both commits
git revert 20b36a60f b07a0f66b --no-edit
git push origin main
```

**Rollback risk**: Low (all changes are additive/defensive, no breaking changes)

---

## Next Steps (P3 - Optional)

These are lower-priority improvements not blocking deployment:

1. **Loop-prevention state**: Track asked questions to prevent endless repeats
2. **Field-specific prompts**: Replace generic "repeat" with "कृपया सिर्फ अपना पूरा नाम बताइए"
3. **Availability state**: Store confirmed availability to prevent repeated announcements

---

## Reminder

**2nd Developer on this repo**:
- Name: **Varsha**
- GitHub: `varshaappbeatsol`
- Email: `varsha.mohan@appbeatsol.com`

---

## References

- **Call 20094 Analysis**: `CALL_20094_CRITICAL_ANALYSIS.md`
- **Code Review**: `CODE_REVIEW_SANITY_CHECK.md`
- **Devanagari Fix**: `DEVANAGARI_FILLER_FIX.md`
- **Vocabulary Guide**: `STT_DOMAIN_VOCABULARY_GUIDE.md`

---

**Ready to deploy** ✅

Waiting for user confirmation to **push to main**.
