---
name: Voice Intel audio tap pattern
description: How VoiceIntelSession receives audio in both telephony and webcall paths
---

## Rule
`SessionConfig.callerAudioTap` (added to `types.ts`) is the hook point for telephony paths. Pipeline calls it in both `onAudioIn` (after mulaw decode → pcm8k) and `onRawPcm8kIn` (Vobiz pcm8k). Webcall has its own separate tap at the gender detector point (line ~1816 in webcall.ts), using `downsample16to8(data)` to produce 8kHz.

**Why:** Webcall is entirely separate from `OrchestrationPipeline` (see webcall-pipeline-split.md), so the tap must be duplicated. Azure Speaker Recognition works with 8kHz mono WAV — all paths normalise to 8kHz PCM before buffering.

**How to apply:** Any new audio-level feature (noise metrics, emotion detection, etc.) should use the same pattern: add a tap to both `pipeline.ts` (for telephony) and `webcall.ts` (for webcall) at the same points.

## Key files
- `artifacts/api-server/src/services/speakerRecognition.ts` — `VoiceIntelSession` class
- `artifacts/api-server/src/orchestration/types.ts` — `SessionConfig.callerAudioTap`
- `artifacts/api-server/src/orchestration/pipeline.ts` — calls tap in `onAudioIn` + `onRawPcm8kIn`
- `artifacts/api-server/src/orchestration/session.ts` — creates `VoiceIntelSession`, passes tap, enrolls at call end
- `artifacts/api-server/src/orchestration/telephony/webcall.ts` — separate tap + enroll at hangup
- `lib/db/src/schema/voicePrints.ts` — `voice_prints` table

## Azure Speaker Recognition notes
- Uses `managed_azure_speech_key` + `managed_azure_speech_region` from `platform_settings` (same as STT)
- Identification is async (202 + Operation-Location polling); enroll at call end; identify after 8s buffer
- `identificationProfiles` endpoint; `shortAudio=true` query param on identify + enroll
