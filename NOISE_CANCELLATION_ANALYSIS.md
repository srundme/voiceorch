# Noise Cancellation Issue Analysis - Call 19901

## Problem Report
User reported: "one of my friend is speaking next to me but stt is also captured and make the mistaks and problms"

## Root Cause

### GTCRN is Speech Enhancement, NOT Speaker Separation

From `voice-isolator.ts` (lines 7-9):
```
This is speech enhancement (keep speech, suppress hiss / fans / traffic), not
"ignore other people talking". A bystander a few metres away is still speech
and must be rejected on RAW mic energy in the pipeline.
```

From `mic-sensitivity.ts` (lines 88-90):
```
Neural isolation keeps ANY speech — including a friend a few metres away — so
barge-in / turn-commit must score the mic energy, not the enhanced signal.
```

**What GTCRN Does:**
- ✅ Suppresses background noise (hiss, fans, traffic, wind, ambient noise)
- ✅ Enhances ALL speech signals
- ❌ Does NOT filter out nearby speakers
- ❌ Does NOT distinguish between primary speaker and others

**What Happened in Call 19901:**
1. User's friend was speaking very close to them
2. GTCRN preserved BOTH voices (as designed)
3. The STT captured both speakers' audio
4. Some transcripts were correctly discarded by self-echo guards, but not all

## Evidence from Call Logs

### Suspicious Transcripts (likely from friend):
- **Turn 2** (line 870): `"I mean, Italy"` - odd phrase, language mismatch
- **Turn 4** (line 1809): `"Mm okay sir you're trying to do"` - English, not Tamil
- **Turn 5** (line 2128): `". . . . . confirm ಮಾಡಿಲ್ಲ"` - Kannada detected (should be Tamil)
- **Turn 6** (line 2531): `"You need to Thank you"` - grammatically odd

### Self-Echo Guards Working (correctly discarded):
- Line 717: `"ஆ பேசலாம் பேசலாம்"` - discarded (agent echo)
- Line 1487: `"I want to"` - discarded (agent echo)
- Line 1603: `"Okay"` - discarded (agent echo)

## Current Defense Mechanism

The system has a `BACKGROUND_TALKER_MIN_RAW_RMS = 800` threshold that's supposed to filter out far-field speakers by checking the **raw** (pre-GTCRN) microphone energy.

**The Problem:** If the friend is **very close** to the microphone, their raw RMS energy will be ABOVE 800, so they pass through this filter.

## Solutions

### Option 1: Increase Background Talker Threshold (Recommended)
Raise the raw RMS threshold to more aggressively filter nearby speakers:

```typescript
// Current: 800
// Proposed: 1200-1500 (more aggressive)
export const BACKGROUND_TALKER_MIN_RAW_RMS = 1200;
```

**Pros:**
- Simple one-line change
- Will filter out more ambient speakers
- Preserves primary speaker (phone holder has highest RMS)

**Cons:**
- May filter soft-spoken primary callers
- Needs testing to find optimal value

### Option 2: Stricter Transcript Validation
Add language consistency checks and anomaly detection:

```typescript
// Discard transcripts that:
// 1. Switch languages unexpectedly
// 2. Have very low language confidence
// 3. Are grammatically incoherent
// 4. Don't match conversation context
```

**Pros:**
- Catches cross-talk after the fact
- Can use LLM context to validate

**Cons:**
- More complex
- May discard valid code-switching

### Option 3: Directional Audio / Beamforming
Use spatial audio processing to focus on the phone holder:

**Pros:**
- Most accurate solution
- Can separate speakers spatially

**Cons:**
- Requires multi-mic array
- Not available on single-mic phones
- Complex implementation

### Option 4: Disable GTCRN for Close-Proximity Scenarios
Allow users to disable voice isolation when in quiet environments:

```typescript
// Add agent config option:
disableVoiceIsolationInQuietEnvironments: boolean
```

**Pros:**
- Simple toggle
- Prevents nearby speaker pickup

**Cons:**
- User needs to know when to toggle
- Loses noise suppression benefit

## Recommended Immediate Fix

**Increase the background talker threshold from 800 → 1200:**

This is empirically tested for "far-field vs near-talker" distinction (per comment in `mic-sensitivity.ts`), but the friend in this case was extremely close. Raising it to 1200 will be more conservative.

**Changes needed:**
1. Update `BACKGROUND_TALKER_MIN_RAW_RMS` in `mic-sensitivity.ts`
2. Test with live calls where someone is nearby
3. Monitor for false negatives (soft-spoken callers being filtered)

## Testing Plan

1. **Test with nearby speakers:** Have someone speak 1-2 meters away while on call
2. **Test soft-spoken callers:** Ensure legitimate soft speech isn't filtered
3. **Monitor transcripts:** Check for unexpected language switches or incoherent text
4. **Check barge-in:** Ensure interruptions still work correctly

## Long-Term Solution

Consider implementing **speaker diarization** - a separate ML model that identifies and tracks individual speakers, then only routes the primary speaker's audio to STT.

Potential libraries:
- pyannote.audio (Python-based speaker diarization)
- Speechbrain speaker recognition
- Custom training on telephony data

This would solve the problem properly but requires significant development effort.
