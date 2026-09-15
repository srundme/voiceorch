# Noise Cancellation Fix - Call 19901

## Issue
User's friend speaking 1-2 meters away was being captured by STT, causing incorrect transcripts with:
- Wrong language detection (English, Kannada instead of Tamil)
- Incoherent phrases ("I mean, Italy", "You need to Thank you")
- Cross-talk interfering with conversation flow

## Root Cause
**GTCRN voice isolation is speech enhancement, not speaker separation.**

GTCRN (the neural model) is designed to:
- ✅ Suppress background noise (fans, traffic, wind, ambient hiss)
- ✅ Enhance ALL speech signals
- ❌ NOT filter out nearby speakers

When someone speaks close to the caller, GTCRN preserves both voices. The system relies on **raw microphone energy** thresholds to filter out bystanders.

## Fix Applied

### Changed `BACKGROUND_TALKER_MIN_RAW_RMS` from 800 → 1200

**File:** `artifacts/api-server/src/orchestration/mic-sensitivity.ts`

**Before:**
```typescript
export const BACKGROUND_TALKER_MIN_RAW_RMS = 800;
```

**After:**
```typescript
export const BACKGROUND_TALKER_MIN_RAW_RMS = 1200;
```

**Why 1200:**
- Original 800 was calibrated for "far-field vs near-talker" but failed when bystander was very close
- 1200 matches the legacy Normal barge-in energy threshold
- More conservative filtering of ambient speakers
- Phone holder (primary speaker) will have consistently higher RMS than nearby bystanders

## Impact

### Positive:
- ✅ Nearby speakers (1-3 meters) will be filtered out more aggressively
- ✅ Reduces cross-talk transcripts
- ✅ Improves conversation accuracy in multi-person environments

### Potential Side Effects:
- ⚠️ Very soft-spoken primary callers might be filtered (needs monitoring)
- ⚠️ Whisper-level speech may not register

## Testing Completed
- ✅ All mic-sensitivity unit tests pass
- ✅ No breaking changes to existing functionality

## Deployment
Ready to deploy. Monitor first few calls for:
1. Nearby speaker filtering (should improve)
2. Soft-spoken caller handling (watch for false negatives)
3. Overall transcript quality

## Long-Term Considerations

For production-grade multi-speaker environments, consider:
1. **Speaker diarization** - ML model to identify and track individual speakers
2. **Directional audio processing** - beamforming (requires multi-mic)
3. **Context-aware transcript validation** - LLM-based anomaly detection
4. **User controls** - allow disabling voice isolation in quiet environments

## Call Analysis Reference
See `NOISE_CANCELLATION_ANALYSIS.md` for detailed analysis of call 19901 logs.
